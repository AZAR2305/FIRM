// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";

import {BaseTest} from "./Base.t.sol";
import {FirmRouter} from "../src/FirmRouter.sol";
import {Route} from "../src/libraries/RouteLib.sol";
import {Status, HookStats, Params} from "../src/interfaces/IScoreboard.sol";
import {FixtureHonestHook, FixtureContextHook, FixtureGasGriefHook, FixtureRevertHook, FixtureQuoteOnlyHook} from "../test-fixtures/FixtureHooks.sol";
import {FixtureHookBase} from "../test-fixtures/FixtureHookBase.sol";

/// @dev Hook that tries to re-enter the router on the real path.
contract ReentrantHook is FixtureHookBase {
    FirmRouter public immutable router;
    address public immutable quoter;

    constructor(IPoolManager pm, FirmRouter router_, address quoter_) FixtureHookBase(pm) {
        router = router_;
        quoter = quoter_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _beforeSwapPermissions();
    }

    function beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != quoter) {
            Route[] memory none = new Route[](0);
            router.swapExactIn(none, 1, 0, address(this), type(uint64).max);
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

contract FirmRouterTest is BaseTest {
    PoolKey keyA; // hookless baseline, 0.25% fee
    PoolKey keyB; // context hook: best quote, hidden ~18% fee on the real path
    PoolKey keyC; // honest hook, slightly lower quote than B
    address hookB;
    address hookC;

    uint128 constant AMOUNT = 1000e18;

    event LegSkipped(bytes32 indexed poolId, address indexed hook, uint8 reason);
    event Rejected(
        bytes32 indexed poolId, address indexed hook, uint256 quotedOut, uint256 settledOut, bool execFailed
    );
    event Filled(
        bytes32 indexed poolId,
        address indexed hook,
        address indexed user,
        uint256 amountIn,
        uint256 quotedOut,
        uint256 settledOut,
        uint8 legIndex
    );
    event NoFill(address indexed user, uint256 amountIn);

    function setUp() public override {
        super.setUp();
        keyA = _initPool(address(0), 2500);

        hookB = _deployHook(
            "FixtureHooks.sol:FixtureContextHook", abi.encode(IPoolManager(address(pm)), address(quoter), 1800), AFTER_SWAP_DELTA
        );
        keyB = _initPool(hookB, 1000);

        hookC = _deployHook(
            "FixtureHooks.sol:FixtureHonestHook", abi.encode(IPoolManager(address(pm)), 13), AFTER_SWAP_DELTA
        );
        keyC = _initPool(hookC, 500);
    }

    function _quote(PoolKey memory key, uint128 amountIn) internal returns (uint256 q) {
        (q,) = quoter.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({poolKey: key, zeroForOne: true, exactAmount: amountIn, hookData: ""})
        );
    }

    // ------------------------------------------------------------ sanity of the demo setup (spec 1.2 / 8.9)
    function test_quoteOrderIsBCA() public {
        uint256 qB = _quote(keyB, AMOUNT);
        uint256 qC = _quote(keyC, AMOUNT);
        uint256 qA = _quote(keyA, AMOUNT);
        emit log_named_decimal_uint("quote B", qB, 18);
        emit log_named_decimal_uint("quote C", qC, 18);
        emit log_named_decimal_uint("quote A", qA, 18);
        assertGt(qB, qC);
        assertGt(qC, qA);
        assertApproxEqAbs(qB, 999.0e18, 0.01e18);
        assertApproxEqAbs(qC, 998.2e18, 0.01e18);
        assertApproxEqAbs(qA, 997.5e18, 0.01e18);
    }

    // ------------------------------------------------------------ happy paths
    function test_honestFill() public {
        uint256 qC = _quote(keyC, AMOUNT);
        uint256 before = token1.balanceOf(user);
        vm.expectEmit(true, true, true, true);
        emit Filled(_poolId(keyC), hookC, user, AMOUNT, qC, qC, 0);
        (uint256 out, int256 leg) = _swap(_routes1(keyC), AMOUNT, 0);
        assertEq(out, qC, "honest settled == quoted");
        assertEq(leg, 0);
        assertEq(token1.balanceOf(user) - before, qC);
        HookStats memory s = sb.stats(hookC);
        assertEq(s.fills, 1);
        assertEq(s.strikes, 0);
        _assertRouterEmpty();
    }

    function test_hooklessPoolFillsAndIsNotRecorded() public {
        (uint256 out, int256 leg) = _swap(_routes1(keyA), AMOUNT, 0);
        assertEq(leg, 0);
        assertGt(out, 997e18);
        assertEq(sb.stats(address(0)).fills, 0);
        _assertRouterEmpty();
    }

    function test_quoteEqualsRealOutputOnHonestPool_S1() public {
        uint256 q = _quote(keyA, AMOUNT);
        (uint256 out,) = _swap(_routes1(keyA), AMOUNT, 0);
        assertEq(out, q);
    }

    // ------------------------------------------------------------ the headline scenario
    function test_contextHookRejectedAndFallsBackToHonestPool() public {
        uint256 qB = _quote(keyB, AMOUNT);
        uint256 qC = _quote(keyC, AMOUNT);
        uint256 userBefore0 = token0.balanceOf(user);
        uint256 userBefore1 = token1.balanceOf(user);

        // B is tried first, rejected with a ~18% shortfall, then C fills at its quote
        vm.expectEmit(true, true, false, false);
        emit Rejected(_poolId(keyB), hookB, qB, 0, false);
        vm.expectEmit(true, true, true, true);
        emit Filled(_poolId(keyC), hookC, user, AMOUNT, qC, qC, 1);
        (uint256 out, int256 leg) = _swap(_routes3(keyB, keyC, keyA), AMOUNT, 0);

        assertEq(leg, 1);
        assertEq(out, qC);
        assertEq(token1.balanceOf(user) - userBefore1, qC);
        assertEq(userBefore0 - token0.balanceOf(user), AMOUNT);

        HookStats memory sB = sb.stats(hookB);
        assertEq(sB.strikes, 1);
        assertEq(uint8(sB.status), uint8(Status.BLOCKED));
        assertApproxEqAbs(sB.cumShortfallBps, 1800, 1);
        assertEq(uint8(sb.statusOf(hookC)), uint8(Status.UNRATED));
        assertEq(sb.stats(hookC).fills, 1);
        _assertRouterEmpty();
    }

    function test_rawRouterLosesTheHiddenFee() public {
        uint256 qB = _quote(keyB, AMOUNT);
        uint256 before = token1.balanceOf(user);
        vm.prank(user);
        uint256 out = raw.swapExactInRaw(_route(keyB), AMOUNT, 0, user);
        assertEq(token1.balanceOf(user) - before, out);
        // ~18% less than the quote (819.18 vs 999.0)
        assertApproxEqRel(out, (qB * 8200) / 10_000, 0.001e18);
        assertEq(token0.balanceOf(address(raw)) + token1.balanceOf(address(raw)), 0);
    }

    function test_firmBeatsRawOnTheSameTrade() public {
        vm.prank(user);
        uint256 rawOut = raw.swapExactInRaw(_route(keyB), AMOUNT, 0, user);
        (uint256 firmOut,) = _swap(_routes3(keyB, keyC, keyA), AMOUNT, 0);
        assertGt(firmOut, rawOut);
        assertApproxEqAbs(firmOut - rawOut, 179e18, 2e18); // ~180 tokens saved
    }

    // ------------------------------------------------------------ all legs fail
    function test_allLegsFail_refundsInputAndStrikesPersist() public {
        uint256 b0 = token0.balanceOf(user);
        uint256 b1 = token1.balanceOf(user);
        vm.expectEmit(true, false, false, true);
        emit NoFill(user, AMOUNT);
        (uint256 out, int256 leg) = _swap(_routes1(keyB), AMOUNT, 0);
        assertEq(out, 0);
        assertEq(leg, -1);
        assertEq(token0.balanceOf(user), b0, "input refunded");
        assertEq(token1.balanceOf(user), b1);
        assertEq(sb.stats(hookB).strikes, 1, "strike persisted although the call returned normally");
        assertEq(uint8(sb.statusOf(hookB)), uint8(Status.BLOCKED));
        _assertRouterEmpty();
    }

    // ------------------------------------------------------------ skips
    function test_blockedHookIsSkipped() public {
        _swap(_routes1(keyB), AMOUNT, 0); // gets B blocked
        uint256 qA = _quote(keyA, AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit LegSkipped(_poolId(keyB), hookB, 0);
        (uint256 out, int256 leg) = _swap(_routes2(keyB, keyA), AMOUNT, 0);
        assertEq(leg, 1);
        assertEq(out, qA);
        assertEq(sb.stats(hookB).strikes, 1, "skipped, not struck again");
    }

    function test_unratedCapSkipsLargeTrades() public {
        Params memory p = sb.getParams();
        p.unratedCap = 100e18;
        sb.setParams(p);
        vm.expectEmit(true, true, false, true);
        emit LegSkipped(_poolId(keyC), hookC, 1);
        (, int256 leg) = _swap(_routes2(keyC, keyA), AMOUNT, 0);
        assertEq(leg, 1);
        // a small trade is allowed through the UNRATED hook
        (, int256 leg2) = _swap(_routes2(keyC, keyA), 50e18, 0);
        assertEq(leg2, 0);
    }

    function test_quoteFailureSkipsLeg() public {
        // a pool that was never initialised: the Quoter reverts, the leg is skipped with reason 2
        PoolKey memory ghost = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        vm.expectEmit(true, true, false, true);
        emit LegSkipped(_poolId(ghost), address(0), 2);
        (, int256 leg) = _swap(_routes2(ghost, keyA), AMOUNT, 0);
        assertEq(leg, 1);
    }

    function test_minTotalOutSkipsLegsThatCannotMeetIt() public {
        uint256 qA = _quote(keyA, AMOUNT);
        // user demands more than anything can deliver: every leg skipped with reason 3, input refunded
        vm.expectEmit(true, true, false, true);
        emit LegSkipped(_poolId(keyA), address(0), 3);
        (uint256 out, int256 leg) = _swap(_routes1(keyA), AMOUNT, uint128(qA + 1e18));
        assertEq(out, 0);
        assertEq(leg, -1);
        _assertRouterEmpty();
    }

    function test_minTotalOutRespectedOnFill() public {
        uint256 qC = _quote(keyC, AMOUNT);
        (uint256 out,) = _swap(_routes1(keyC), AMOUNT, uint128(qC - qC / 100));
        assertGe(out, qC - qC / 100);
    }

    // ------------------------------------------------------------ hostile hooks
    function test_gasGriefHookIsIsolated() public {
        address g = _deployHook(
            "FixtureHooks.sol:FixtureGasGriefHook", abi.encode(IPoolManager(address(pm)), address(quoter)), BEFORE_SWAP
        );
        PoolKey memory keyG = _initPool(g, 100);
        uint256 qG = _quote(keyG, AMOUNT);
        uint256 qA = _quote(keyA, AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit Rejected(_poolId(keyG), g, qG, 0, true);
        (uint256 out, int256 leg) = _swap(_routes2(keyG, keyA), AMOUNT, 0);
        assertEq(leg, 1);
        assertEq(out, qA);
        assertEq(uint8(sb.statusOf(g)), uint8(Status.BLOCKED));
        assertEq(sb.stats(g).cumShortfallBps, 10_000);
        _assertRouterEmpty();
    }

    function test_revertHookIsIsolated() public {
        address r = _deployHook(
            "FixtureHooks.sol:FixtureRevertHook",
            abi.encode(IPoolManager(address(pm)), address(quoter), false),
            BEFORE_SWAP
        );
        PoolKey memory keyR = _initPool(r, 100);
        (uint256 out, int256 leg) = _swap(_routes2(keyR, keyA), AMOUNT, 0);
        assertEq(leg, 1);
        assertGt(out, 0);
        assertEq(uint8(sb.statusOf(r)), uint8(Status.BLOCKED));
        _assertRouterEmpty();
    }

    function test_returnDataBombCannotBreakTheRouter() public {
        address r = _deployHook(
            "FixtureHooks.sol:FixtureRevertHook",
            abi.encode(IPoolManager(address(pm)), address(quoter), true),
            BEFORE_SWAP
        );
        PoolKey memory keyR = _initPool(r, 100);
        (uint256 out, int256 leg) = _swap(_routes2(keyR, keyA), AMOUNT, 0);
        assertEq(leg, 1, "fell back to the next route");
        assertGt(out, 0);
        assertEq(sb.stats(r).strikes, 1);
        _assertRouterEmpty();
    }

    function test_reentrancyAttemptIsContainedAndStruck() public {
        address h = _deployHook(
            "ReentrantHook", abi.encode(IPoolManager(address(pm)), router, address(quoter)), BEFORE_SWAP
        );
        PoolKey memory keyH = _initPool(h, 100);
        (uint256 out, int256 leg) = _swap(_routes2(keyH, keyA), AMOUNT, 0);
        assertEq(leg, 1);
        assertGt(out, 0);
        assertEq(sb.stats(h).strikes, 1);
        _assertRouterEmpty();
    }

    // ------------------------------------------------------------ advertisedOut (P1)
    function test_advertisedMismatchSkipsQuoteOnlyHook() public {
        address q = _deployHook(
            "FixtureHooks.sol:FixtureQuoteOnlyHook", abi.encode(IPoolManager(address(pm)), uint24(10_000)), BEFORE_SWAP
        );
        PoolKey memory keyQ = _initPool(q, LPFeeLibrary.DYNAMIC_FEE_FLAG);

        // what an off-chain eth_call sees (gasprice 0) is inflated vs what a real transaction gets
        vm.txGasPrice(0);
        uint256 advertised = _quote(keyQ, AMOUNT);
        vm.txGasPrice(1 gwei);
        uint256 inTx = _quote(keyQ, AMOUNT);
        assertGt(advertised, inTx + 9e18, "simulated quote is ~1% better");

        // without advertisedOut the user silently gets the lower price and nothing is struck: the known gap
        (uint256 outNoAdv, int256 legNoAdv) = _swap(_routes1(keyQ), AMOUNT, 0);
        assertEq(legNoAdv, 0);
        assertEq(outNoAdv, inTx);
        assertEq(sb.stats(q).strikes, 0);

        // with advertisedOut the leg is skipped (reason 4) and the next route fills; still no strike
        Route[] memory rs = _routes2(keyQ, keyA);
        rs[0].advertisedOut = uint128(advertised);
        vm.expectEmit(true, true, false, true);
        emit LegSkipped(_poolId(keyQ), q, 4);
        vm.prank(user);
        (, int256 leg) = router.swapExactIn(rs, AMOUNT, 0, user, uint64(block.timestamp + 1 hours));
        assertEq(leg, 1);
        assertEq(sb.stats(q).strikes, 0, "market-move ambiguity: skip, never strike");
    }

    function test_advertisedWithinToleranceIsAccepted() public {
        uint256 qC = _quote(keyC, AMOUNT);
        Route[] memory rs = _routes1(keyC);
        rs[0].advertisedOut = uint128(qC + qC / 1000); // 10 bps stale: inside 50 bps
        vm.prank(user);
        (, int256 leg) = router.swapExactIn(rs, AMOUNT, 0, user, uint64(block.timestamp + 1 hours));
        assertEq(leg, 0);
    }

    // ------------------------------------------------------------ input validation
    function test_deadlinePassed() public {
        vm.prank(user);
        vm.expectRevert(FirmRouter.DeadlinePassed.selector);
        router.swapExactIn(_routes1(keyA), AMOUNT, 0, user, uint64(block.timestamp - 1));
    }

    function test_badRouteCount() public {
        vm.startPrank(user);
        Route[] memory none = new Route[](0);
        vm.expectRevert(FirmRouter.BadRouteCount.selector);
        router.swapExactIn(none, AMOUNT, 0, user, uint64(block.timestamp));
        Route[] memory five = new Route[](5);
        for (uint256 i = 0; i < 5; i++) five[i] = _route(keyA);
        vm.expectRevert(FirmRouter.BadRouteCount.selector);
        router.swapExactIn(five, AMOUNT, 0, user, uint64(block.timestamp));
        vm.stopPrank();
    }

    function test_routeTokenMismatch() public {
        Route[] memory rs = _routes2(keyA, keyC);
        rs[1].zeroForOne = false; // opposite direction
        vm.prank(user);
        vm.expectRevert(FirmRouter.RouteTokenMismatch.selector);
        router.swapExactIn(rs, AMOUNT, 0, user, uint64(block.timestamp));
    }

    function test_nativeCurrencyRejected() public {
        PoolKey memory native = keyA;
        native.currency0 = Currency.wrap(address(0));
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("NativeCurrencyUnsupported()"));
        router.swapExactIn(_routes1(native), AMOUNT, 0, user, uint64(block.timestamp));
    }

    function test_executeLegOnlySelf() public {
        vm.expectRevert(FirmRouter.OnlySelf.selector);
        router.executeLeg(_route(keyA), AMOUNT, 0);
    }

    function test_unlockCallbackOnlyPoolManager() public {
        vm.expectRevert(abi.encodeWithSignature("OnlyPoolManager()"));
        router.unlockCallback("");
    }

    function test_insufficientGasRevertsInsteadOfFalseStrike() public {
        vm.prank(user);
        (bool ok,) = address(router).call{gas: 300_000}(
            abi.encodeCall(router.swapExactIn, (_routes1(keyC), AMOUNT, 0, user, uint64(block.timestamp + 1 hours)))
        );
        assertFalse(ok, "low gas limit reverts");
        assertEq(sb.stats(hookC).strikes, 0, "no false strike from a starved leg");
    }

    // ------------------------------------------------------------ admin
    function test_setCapsBoundsAndOwnerOnly() public {
        router.setCaps(600_000, 500_000, 75);
        assertEq(router.legGasCap(), 600_000);
        assertEq(router.quoteGasCap(), 500_000);
        assertEq(router.advTolBps(), 75);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setCaps(99_999, 500_000, 75);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setCaps(600_000, 5_000_001, 75);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setCaps(600_000, 500_000, 1001);
        vm.prank(user);
        vm.expectRevert();
        router.setCaps(600_000, 500_000, 75);
    }

    function test_rescueTokenOnlyOwner() public {
        token0.ownerMint(address(router), 5e18); // sent by mistake
        vm.prank(user);
        vm.expectRevert();
        router.rescueToken(address(token0), user, 5e18);
        router.rescueToken(address(token0), address(this), 5e18);
        _assertRouterEmpty();
    }

    // ------------------------------------------------------------ fuzz / invariants
    /// Router holds zero balance after every call; the user either receives exactly `out` for exactly `amountIn`,
    /// or gets the full input back and nothing out.
    function testFuzz_routerEmptyAndUserProtected(uint128 amount, uint8 order) public {
        amount = uint128(bound(amount, 1e15, 5000e18));
        Route[] memory rs;
        uint256 o = order % 6;
        if (o == 0) rs = _routes3(keyA, keyB, keyC);
        else if (o == 1) rs = _routes3(keyA, keyC, keyB);
        else if (o == 2) rs = _routes3(keyB, keyA, keyC);
        else if (o == 3) rs = _routes3(keyB, keyC, keyA);
        else if (o == 4) rs = _routes3(keyC, keyA, keyB);
        else rs = _routes3(keyC, keyB, keyA);

        uint256 u0 = token0.balanceOf(user);
        uint256 u1 = token1.balanceOf(user);
        (uint256 out, int256 leg) = _swap(rs, amount, 0);

        _assertRouterEmpty();
        if (leg >= 0) {
            assertEq(u0 - token0.balanceOf(user), amount);
            assertEq(token1.balanceOf(user) - u1, out);
            assertGt(out, 0);
            // the filled leg never delivered below its floor: an 18% hidden-fee pool can never have been the fill
            assertTrue(address(rs[uint256(leg)].key.hooks) != hookB, "context hook never fills");
        } else {
            assertEq(token0.balanceOf(user), u0);
            assertEq(token1.balanceOf(user), u1);
        }
    }

    function testFuzz_strikesNeverDecrease(uint8 rounds) public {
        rounds = uint8(bound(rounds, 1, 6));
        uint32 prev;
        for (uint8 i = 0; i < rounds; i++) {
            _swap(_routes3(keyB, keyC, keyA), 100e18, 0);
            uint32 now_ = sb.stats(hookB).strikes;
            assertGe(now_, prev);
            prev = now_;
        }
    }
}
