// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {BaseTest} from "./Base.t.sol";
import {CanaryRunner} from "../src/CanaryRunner.sol";
import {ProbeSender} from "../src/ProbeSender.sol";
import {Route} from "../src/libraries/RouteLib.sol";
import {Status, HookStats} from "../src/interfaces/IScoreboard.sol";

contract CanaryRunnerTest is BaseTest {
    PoolKey keyA; // hookless
    PoolKey keyC; // honest
    PoolKey keyB; // context (quote-spoofing)
    PoolKey keyS; // sender-aware: honest to Quoter + FirmRouter only
    PoolKey keyR; // random fee
    PoolKey keyG; // gas grief
    address hookC;
    address hookB;
    address hookS;
    address hookR;
    address hookG;

    uint128 constant DUST = 10e18;

    event ProbeDone(
        bytes32 indexed poolId,
        address indexed hook,
        address indexed probeSender,
        uint128 amountIn,
        uint256 quotedOut,
        uint256 settledOut
    );

    function setUp() public override {
        super.setUp();
        IPoolManager ipm = IPoolManager(address(pm));
        keyA = _initPool(address(0), 2500);

        hookC = _deployHook("FixtureHooks.sol:FixtureHonestHook", abi.encode(ipm, 13), AFTER_SWAP_DELTA);
        keyC = _initPool(hookC, 500);

        hookB = _deployHook(
            "FixtureHooks.sol:FixtureContextHook", abi.encode(ipm, address(quoter), 1800), AFTER_SWAP_DELTA
        );
        keyB = _initPool(hookB, 1000);

        hookS = _deployHook(
            "FixtureHooks.sol:FixtureSenderAwareHook",
            abi.encode(ipm, address(quoter), address(router), 500),
            AFTER_SWAP_DELTA
        );
        keyS = _initPool(hookS, 1000);

        hookR = _deployHook(
            "FixtureHooks.sol:FixtureRandomFeeHook", abi.encode(ipm, address(quoter), 500, 2000), AFTER_SWAP_DELTA
        );
        keyR = _initPool(hookR, 1000);

        hookG = _deployHook("FixtureHooks.sol:FixtureGasGriefHook", abi.encode(ipm, address(quoter)), BEFORE_SWAP);
        keyG = _initPool(hookG, 1000);
    }

    function _probe(PoolKey memory key, uint8 idx) internal returns (uint256 q, uint256 s) {
        vm.prank(user);
        return canary.probe(_route(key), DUST, idx);
    }

    // ------------------------------------------------------------ sender identities
    function test_probeSendersAreDistinctDeterministicAndLazy() public {
        address a0 = canary.probeSenderAddress(0);
        address a1 = canary.probeSenderAddress(1);
        assertTrue(a0 != a1);
        assertEq(a0.code.length, 0, "not deployed yet");
        _probe(keyC, 0);
        assertGt(a0.code.length, 0, "deployed on first use");
        assertEq(ProbeSender(a0).runner(), address(canary));
        _probe(keyC, 1);
        assertGt(a1.code.length, 0);
        assertEq(canary.probeSenderAddress(0), a0, "address is stable");
    }

    function test_probeSenderRunIsRunnerOnly() public {
        _probe(keyC, 0);
        ProbeSender ps = ProbeSender(canary.probeSenderAddress(0));
        vm.expectRevert(ProbeSender.OnlyRunner.selector);
        ps.run(_route(keyC), 1e18, 1_000_000, 1_000_000);
        vm.expectRevert(ProbeSender.OnlySelf.selector);
        ps.exec(_route(keyC), 1e18);
    }

    // ------------------------------------------------------------ honest hook (no false positives)
    function test_honestHookGetsRatedNormalByProbes() public {
        assertEq(uint8(sb.statusOf(hookC)), uint8(Status.UNRATED));
        for (uint256 i = 0; i < 6; i++) _probe(keyC, uint8(i % 3));
        HookStats memory s = sb.stats(hookC);
        assertEq(s.strikes, 0, "zero false positives");
        assertEq(s.cleanProbes, 6);
        assertEq(s.cleanProbeSenders, 3);
        assertEq(uint8(s.status), uint8(Status.NORMAL));
    }

    function test_probeReturnsOutputToCaller() public {
        uint256 b0 = token0.balanceOf(user);
        uint256 b1 = token1.balanceOf(user);
        (uint256 q, uint256 s) = _probe(keyC, 0);
        assertEq(q, s, "honest: quote == settled");
        assertEq(b0 - token0.balanceOf(user), DUST);
        assertEq(token1.balanceOf(user) - b1, s);
        assertEq(token0.balanceOf(address(canary)) + token1.balanceOf(address(canary)), 0);
        ProbeSender ps = ProbeSender(canary.probeSenderAddress(0));
        assertEq(token0.balanceOf(address(ps)) + token1.balanceOf(address(ps)), 0);
    }

    function test_probeEmitsProbeDone() public {
        (uint256 q,) = _probe(keyC, 0); // deploy sender so we know the address
        address ps = canary.probeSenderAddress(0);
        vm.expectEmit(true, true, true, false);
        emit ProbeDone(_poolId(keyC), hookC, ps, DUST, q, q);
        _probe(keyC, 0);
    }

    // ------------------------------------------------------------ spoofing hooks
    function test_contextHookBlockedByFirstProbe() public {
        (uint256 q, uint256 s) = _probe(keyB, 0);
        assertApproxEqRel(s, (q * 8200) / 10_000, 0.001e18);
        HookStats memory st = sb.stats(hookB);
        assertEq(st.probeStrikes, 1);
        assertEq(uint8(st.status), uint8(Status.BLOCKED));
    }

    function test_senderAwareHookLooksCleanThroughFirmRouterButIsCaughtByCanary() public {
        // Through FirmRouter: honest to Quoter and router => clean fills, never struck
        for (uint256 i = 0; i < 3; i++) {
            (uint256 out, int256 leg) = _swap(_routes1(keyS), 100e18, 0);
            assertEq(leg, 0);
            assertGt(out, 0);
        }
        assertEq(sb.stats(hookS).strikes, 0, "invisible to the in-tx check");
        assertEq(sb.stats(hookS).fills, 3);
        assertEq(uint8(sb.statusOf(hookS)), uint8(Status.UNRATED));

        // Canary probes from another identity: quote (honest) vs real (5% fee) => strike
        (uint256 q, uint256 s) = _probe(keyS, 0);
        assertLt(s, q);
        HookStats memory st = sb.stats(hookS);
        assertEq(st.probeStrikes, 1);
        assertEq(st.strikes, 1);
        assertEq(uint8(st.status), uint8(Status.BLOCKED)); // 5% > 2% severe
    }

    function test_randomFeeHookCaughtWithinAFewProbes() public {
        uint256 n;
        while (sb.statusOf(hookR) != Status.BLOCKED && n < 40) {
            vm.warp(block.timestamp + 12);
            _probe(keyR, uint8(n % 4));
            n++;
        }
        assertEq(uint8(sb.statusOf(hookR)), uint8(Status.BLOCKED), "caught");
        assertLe(n, 20, "a 50% hook is caught inside ~a dozen probes");
        emit log_named_uint("probes until BLOCKED (random-fee hook)", n);
    }

    // ------------------------------------------------------------ hostile behaviour
    function test_gasGriefProbeIsContainedAndRefunded() public {
        uint256 b0 = token0.balanceOf(user);
        uint256 b1 = token1.balanceOf(user);
        (uint256 q, uint256 s) = _probe(keyG, 0);
        assertGt(q, 0);
        assertEq(s, 0);
        assertEq(token0.balanceOf(user), b0, "dust refunded");
        assertEq(token1.balanceOf(user), b1);
        HookStats memory st = sb.stats(hookG);
        assertEq(st.probeStrikes, 1);
        assertEq(uint8(st.status), uint8(Status.BLOCKED));
    }

    // ------------------------------------------------------------ no evidence cases
    function test_failedQuoteLeavesStatsUnchanged() public {
        address ghostHook = address(uint160(AFTER_SWAP_DELTA) | (uint160(0xABCD) << 144));
        PoolKey memory ghost = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(ghostHook)
        });
        vm.prank(user);
        (uint256 q, uint256 s) = canary.probe(_route(ghost), DUST, 0);
        assertEq(q, 0);
        assertEq(s, 0);
        HookStats memory st = sb.stats(ghostHook);
        assertEq(st.probes, 0);
        assertEq(st.firstSeenAt, 0);
    }

    function test_hooklessProbeIsNotRecorded() public {
        (uint256 q, uint256 s) = _probe(keyA, 0);
        assertEq(q, s);
        assertEq(sb.stats(address(0)).probes, 0);
    }

    function test_canaryMustBeReporterToRecord() public {
        sb.setReporter(address(canary), false);
        vm.prank(user);
        vm.expectRevert();
        canary.probe(_route(keyC), DUST, 0);
    }

    // ------------------------------------------------------------ B4: with vs without canaries
    function test_B4_detectionWithAndWithoutCanary() public {
        // without canaries: 10 protected swaps through FirmRouter never strike the sender-aware hook
        for (uint256 i = 0; i < 10; i++) _swap(_routes1(keyS), 10e18, 0);
        assertEq(sb.stats(hookS).strikes, 0);
        // with one canary probe: struck
        _probe(keyS, 1);
        assertEq(sb.stats(hookS).strikes, 1);
    }

    function test_setCapsOwnerOnlyAndBounded() public {
        canary.setCaps(500_000, 500_000);
        assertEq(canary.legGasCap(), 500_000);
        vm.expectRevert(CanaryRunner.CapOutOfBounds.selector);
        canary.setCaps(50_000, 500_000);
        vm.prank(user);
        vm.expectRevert();
        canary.setCaps(500_000, 500_000);
    }
}
