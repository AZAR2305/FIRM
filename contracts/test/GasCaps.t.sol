// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";

import {BaseTest} from "./Base.t.sol";
import {FirmRouter} from "../src/FirmRouter.sol";
import {CanaryRunner} from "../src/CanaryRunner.sol";
import {GasBounds} from "../src/libraries/GasBounds.sol";
import {Status, HookStats} from "../src/interfaces/IScoreboard.sol";

/// Every gas number in this file, and in the docs that quote it, is FORK-MEASURED / LOCAL-EVM-MEASURED on Ethereum's gas
/// schedule, NOT Monad-measured. Monad reprices cold storage and account access, so the same hooks cost more there
/// (docs/SPIKES.md S5 adds the repricing as an estimate). The tests pin behaviour, not Monad prices.
contract GasCapsTest is BaseTest {
    PoolKey keyA; // hookless
    PoolKey keyC; // FixtureHonestHook: the "typical" honest hook
    address hookC;

    uint128 constant AMOUNT = 1000e18;

    event LegSkipped(bytes32 indexed poolId, address indexed hook, uint8 reason);
    event Rejected(
        bytes32 indexed poolId, address indexed hook, uint256 quotedOut, uint256 settledOut, bool execFailed
    );
    event StrikeRecorded(
        address indexed hook,
        bytes32 indexed poolId,
        uint256 quotedOut,
        uint256 settledOut,
        uint256 shortfallBps,
        bool execFailed
    );
    event StatusChanged(address indexed hook, Status oldStatus, Status newStatus, bytes32 reason);
    event CapsSet(uint256 legGasCap, uint256 quoteGasCap, uint16 advTolBps);
    event GasReserveSet(uint256 gasReserve);

    function setUp() public override {
        super.setUp();
        keyA = _initPool(address(0), 2500);
        hookC = _deployHook(
            "FixtureHooks.sol:FixtureHonestHook", abi.encode(IPoolManager(address(pm)), 13), AFTER_SWAP_DELTA
        );
        keyC = _initPool(hookC, 500);
    }

    // ------------------------------------------------------------------ measurement helpers
    /// A real transaction starts with every account and slot cold. Inside one Foundry test everything touched earlier is
    /// warm, which would make later measurements cheaper and the ratios between them meaningless, so cool it all first.
    function _cool(PoolKey memory key) internal {
        vm.cool(address(pm));
        vm.cool(address(quoter));
        vm.cool(address(raw));
        vm.cool(address(router));
        vm.cool(address(sb));
        vm.cool(address(token0));
        vm.cool(address(token1));
        vm.cool(user);
        if (address(key.hooks) != address(0)) vm.cool(address(key.hooks));
    }

    function _quoteGas(PoolKey memory key) internal returns (uint256 g) {
        _cool(key);
        uint256 before = gasleft();
        quoter.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({poolKey: key, zeroForOne: true, exactAmount: AMOUNT, hookData: ""})
        );
        g = before - gasleft();
    }

    /// whole RawRouter swap: the leg plus the two token transfers the router does outside it, so it slightly overstates the
    /// gas of the capped leg (the conservative direction for judging the cap)
    function _legGas(PoolKey memory key) internal returns (uint256 g) {
        _cool(key);
        vm.prank(user);
        uint256 before = gasleft();
        raw.swapExactInRaw(_route(key), AMOUNT, 0, user);
        g = before - gasleft();
    }

    function _heavyPool(uint256 extraQuote, uint256 extraReal) internal returns (PoolKey memory key, address hook) {
        hook = _deployHook(
            "FixtureHooks.sol:FixtureHeavyHonestHook",
            abi.encode(IPoolManager(address(pm)), address(quoter), extraQuote, extraReal),
            BEFORE_SWAP
        );
        key = _initPool(hook, 100);
    }

    // ------------------------------------------------------------------ the typical honest case and its margin to the caps
    function test_typicalHonestGasAndMarginToTheCaps() public {
        uint256 qA = _quoteGas(keyA);
        uint256 qC = _quoteGas(keyC);
        uint256 lA = _legGas(keyA);
        uint256 lC = _legGas(keyC);
        emit log_named_uint("quote gas, hookless pool A   (Ethereum schedule)", qA);
        emit log_named_uint("quote gas, honest hook C     (Ethereum schedule)", qC);
        emit log_named_uint("leg gas,   hookless pool A   (Ethereum schedule)", lA);
        emit log_named_uint("leg gas,   honest hook C     (Ethereum schedule)", lC);
        emit log_named_uint("quoteGasCap", router.quoteGasCap());
        emit log_named_uint("legGasCap", router.legGasCap());
        emit log_named_decimal_uint("quote cap / worst quote here (x)", (router.quoteGasCap() * 1e18) / _max(qA, qC), 18);
        emit log_named_decimal_uint("leg cap / worst leg here (x)", (router.legGasCap() * 1e18) / _max(lA, lC), 18);
        assertLt(_max(qA, qC), router.quoteGasCap());
        assertLt(_max(lA, lC), router.legGasCap());
    }

    // ------------------------------------------------------------------ honest but expensive hooks
    /// What the honest fixture's own callback adds to a swap, measured: roughly 25k to 40k on the Ethereum schedule (the
    /// difference between a swap through pool C and through the hookless pool A, which moves with warm/cold effects).
    uint256 constant TYPICAL_HOOK_GAS = 40_000;

    /// An honest hook that uses TWICE the gas of a typical honest hook is neither struck nor skipped. The same extra work
    /// runs on the quote path (the Quoter executes the hook too) and on the real path.
    function test_honestHookUsing2xTheTypicalHookGasIsNotBlocked() public {
        uint256 extra = 2 * TYPICAL_HOOK_GAS;
        (PoolKey memory keyH, address hookH) = _heavyPool(extra, extra);
        emit log_named_uint("extra gas the heavy honest hook burns on each path", extra);
        emit log_named_uint("its quote gas", _quoteGas(keyH));
        emit log_named_uint("its leg gas  ", _legGas(keyH));

        uint256 before1 = token1.balanceOf(user);
        (uint256 out, int256 leg) = _swap(_routes2(keyH, keyA), AMOUNT, 0);
        assertEq(leg, 0, "the 2x-gas honest hook filled the order itself");
        assertGt(out, 0);
        assertEq(token1.balanceOf(user) - before1, out);
        HookStats memory s = sb.stats(hookH);
        assertEq(s.strikes, 0, "not struck for being expensive");
        assertEq(s.fills, 1);
        assertTrue(s.status != Status.BLOCKED, "not blocked");
        _assertRouterEmpty();
    }

    /// How much more can an honest hook burn before a cap stops it? Searches the extra gas (same on both paths, as real hook
    /// code is) and reports which cap binds first. FORK-MEASURED (Ethereum schedule), not Monad-measured.
    function test_howMuchExtraGasAnHonestHookMayBurnBeforeACapStopsIt() public {
        uint256 lastFilled;
        uint256 firstStopped;
        uint256 stopReason; // 2 = quote cap (route skipped, no strike), 99 = leg cap (strike)
        for (uint256 burn = 0; burn <= 600_000; burn += 10_000) {
            uint256 snap = vm.snapshotState();
            (PoolKey memory k, address h) = _heavyPool(burn, burn);
            (, int256 leg) = _swap(_routes2(k, keyA), AMOUNT, 0);
            uint256 strikes = sb.stats(h).strikes;
            vm.revertToState(snap);
            if (leg == 0) {
                lastFilled = burn;
            } else {
                firstStopped = burn;
                stopReason = strikes > 0 ? 99 : 2;
                break;
            }
        }
        emit log_named_uint("quoteGasCap", router.quoteGasCap());
        emit log_named_uint("legGasCap  ", router.legGasCap());
        emit log_named_uint("largest extra gas per path that still fills", lastFilled);
        emit log_named_uint("first extra gas that no longer fills", firstStopped);
        emit log_named_uint("binding cap: 2 = quote cap (skipped, no strike), 99 = leg cap (strike)", stopReason);
        emit log_named_decimal_uint("room as a multiple of the typical hook gas (x)", (lastFilled * 1e18) / TYPICAL_HOOK_GAS, 18);
        assertEq(stopReason, 2, "the quote cap binds first, so the stop is a silent skip, not a false strike");
        assertGt(lastFilled, 3 * TYPICAL_HOOK_GAS, "room for at least ~3x the typical honest hook, on this schedule");
    }

    // ------------------------------------------------------------------ where a cap that is too tight DOES hurt an honest hook
    /// FLAG 1 (quote cap): an honest hook whose QUOTE exceeds the quote cap is skipped (LegSkipped reason 2). It is not
    /// struck, so nothing on the Scoreboard shows it: it just never gets flow.
    function test_FLAG_honestHookOverTheQuoteCapIsSkippedNotStruck() public {
        (PoolKey memory keyH, address hookH) = _heavyPool(router.quoteGasCap(), 0);
        vm.expectEmit(true, true, false, true);
        emit LegSkipped(_poolId(keyH), hookH, 2);
        (, int256 leg) = _swap(_routes2(keyH, keyA), AMOUNT, 0);
        assertEq(leg, 1, "fell through to the next route");
        assertEq(sb.stats(hookH).strikes, 0, "skipped, never struck");
        assertEq(sb.stats(hookH).firstSeenAt, 0, "and invisible on the Scoreboard");
    }

    /// FLAG 2 (leg cap): an honest hook whose REAL-PATH leg exceeds the leg cap while its quote does not (a hook that skips
    /// work when simulated, or a costly token transfer) is recorded as execFailed: a 100% shortfall, SEVERE, BLOCKED on the
    /// very first occurrence. The owner can raise the cap and reinstate it.
    function test_FLAG_honestHookOverTheLegCapIsStruckAndBlocked_thenFixedBySetCaps() public {
        (PoolKey memory keyH, address hookH) = _heavyPool(0, router.legGasCap());
        uint256 q = _quoteGas(keyH);

        vm.expectEmit(true, true, false, false);
        emit Rejected(_poolId(keyH), hookH, q, 0, true);
        (, int256 leg) = _swap(_routes2(keyH, keyA), AMOUNT, 0);
        assertEq(leg, 1, "fell back");
        HookStats memory s = sb.stats(hookH);
        assertEq(s.strikes, 1, "FALSE POSITIVE: an honest hook was struck for being heavy");
        assertEq(uint8(s.status), uint8(Status.BLOCKED), "and blocked at once (execFailed is a 100% shortfall)");

        // the retune path: raise the cap, reinstate, and the same hook now fills
        router.setCaps(1_500_000, router.quoteGasCap(), router.advTolBps());
        sb.reinstate(hookH);
        (, int256 leg2) = _swap(_routes2(keyH, keyA), AMOUNT, 0);
        assertEq(leg2, 0, "after setCaps + reinstate the honest hook fills");
    }

    /// FLAG 3 (probes): CanaryRunner has its own caps. A probe whose leg runs out of gas settles 0, which recordProbe counts
    /// as a full shortfall, so an honest heavy hook is struck through the canary too if the canary's leg cap is too tight.
    function test_FLAG_canaryProbeStrikesAnHonestHeavyHookWhenItsLegCapIsTight() public {
        (PoolKey memory keyH, address hookH) = _heavyPool(0, canary.legGasCap());
        vm.prank(user);
        (uint256 quoted, uint256 settled) = canary.probe(_route(keyH), 10e18, 0);
        assertGt(quoted, 0);
        assertEq(settled, 0, "the probe leg ran out of gas");
        assertEq(sb.stats(hookH).probeStrikes, 1, "honest hook struck via the canary");
        assertEq(uint8(sb.stats(hookH).status), uint8(Status.BLOCKED));
    }

    // ------------------------------------------------------------------ the gas-grief fixture: out-of-gas is recorded correctly
    function test_gasGriefOutOfGasIsRecordedCorrectly() public {
        address g = _deployHook(
            "FixtureHooks.sol:FixtureGasGriefHook", abi.encode(IPoolManager(address(pm)), address(quoter)), BEFORE_SWAP
        );
        PoolKey memory keyG = _initPool(g, 100);
        uint256 quoted = _quotedOut(keyG);

        // 1) the router records exactly one strike, as an execution failure, with the full-shortfall figure
        // order: the Scoreboard writes first (status, then the strike), then the router reports the rejected leg
        vm.expectEmit(true, false, false, true);
        emit StatusChanged(g, Status.UNRATED, Status.BLOCKED, "SEVERE_SHORTFALL");
        vm.expectEmit(true, true, false, true);
        emit StrikeRecorded(g, _poolId(keyG), quoted, 0, 10_000, true);
        vm.expectEmit(true, true, false, true);
        emit Rejected(_poolId(keyG), g, quoted, 0, true);
        uint256 gasBefore = gasleft();
        (uint256 out, int256 leg) = _swap(_routes1(keyG), AMOUNT, 0);
        uint256 gasUsed = gasBefore - gasleft();
        assertEq(out, 0);
        assertEq(leg, -1, "NoFill: the only route failed");

        HookStats memory s = sb.stats(g);
        assertEq(s.strikes, 1);
        assertEq(s.fills, 0);
        assertEq(s.cumShortfallBps, 10_000);
        assertEq(s.lastStrikeAt, uint64(block.timestamp));
        assertEq(uint8(s.status), uint8(Status.BLOCKED));

        // 2) the cap, not luck, bounded the loss: the leg burned (about) its whole cap and the call still finished
        emit log_named_uint("gas used by the whole NoFill swap (Ethereum schedule)", gasUsed);
        assertGe(gasUsed, (router.legGasCap() * 95) / 100, "the hostile leg burned its cap");
        assertLe(gasUsed, router.quoteGasCap() + router.legGasCap() + router.gasReserve(), "and no more than quote + cap + reserve");
        _assertRouterEmpty();

        // 3) the next swap does not pay for it again: BLOCKED hooks are skipped, not struck twice
        vm.expectEmit(true, true, false, true);
        emit LegSkipped(_poolId(keyG), g, 0);
        _swap(_routes2(keyG, keyA), AMOUNT, 0);
        assertEq(sb.stats(g).strikes, 1);
    }

    function _quotedOut(PoolKey memory key) internal returns (uint256 q) {
        (q,) = quoter.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({poolKey: key, zeroForOne: true, exactAmount: AMOUNT, hookData: ""})
        );
    }

    // ------------------------------------------------------------------ owner configuration
    function test_capsAreOwnerConfigurableWithinBounds() public {
        // defaults are inside the bounds
        assertEq(router.legGasCap(), GasBounds.DEFAULT_LEG_CAP);
        assertEq(router.quoteGasCap(), GasBounds.DEFAULT_QUOTE_CAP);
        assertEq(router.gasReserve(), GasBounds.DEFAULT_RESERVE);

        vm.expectEmit(false, false, false, true);
        emit CapsSet(525_000, 250_000, 50);
        router.setCaps(525_000, 250_000, 50);
        assertEq(router.legGasCap(), 525_000);
        assertEq(router.quoteGasCap(), 250_000);

        // bounds, both ends, for both caps
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setCaps(GasBounds.MIN_LEG_CAP - 1, 250_000, 50);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setCaps(GasBounds.MAX_LEG_CAP + 1, 250_000, 50);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setCaps(525_000, GasBounds.MIN_QUOTE_CAP - 1, 50);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setCaps(525_000, GasBounds.MAX_QUOTE_CAP + 1, 50);
        router.setCaps(GasBounds.MIN_LEG_CAP, GasBounds.MIN_QUOTE_CAP, 50);
        router.setCaps(GasBounds.MAX_LEG_CAP, GasBounds.MAX_QUOTE_CAP, 50);

        // reserve
        vm.expectEmit(false, false, false, true);
        emit GasReserveSet(400_000);
        router.setGasReserve(400_000);
        assertEq(router.gasReserve(), 400_000);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setGasReserve(GasBounds.MIN_RESERVE - 1);
        vm.expectRevert(FirmRouter.CapOutOfBounds.selector);
        router.setGasReserve(GasBounds.MAX_RESERVE + 1);

        // owner only
        vm.startPrank(user);
        vm.expectRevert();
        router.setCaps(525_000, 250_000, 50);
        vm.expectRevert();
        router.setGasReserve(400_000);
        vm.stopPrank();
    }

    function test_canaryCapsAreOwnerConfigurableWithinBounds() public {
        canary.setCaps(525_000, 250_000);
        assertEq(canary.legGasCap(), 525_000);
        canary.setGasReserve(400_000);
        assertEq(canary.gasReserve(), 400_000);
        vm.expectRevert(CanaryRunner.CapOutOfBounds.selector);
        canary.setCaps(GasBounds.MIN_LEG_CAP - 1, 250_000);
        vm.expectRevert(CanaryRunner.CapOutOfBounds.selector);
        canary.setGasReserve(GasBounds.MAX_RESERVE + 1);
        vm.prank(user);
        vm.expectRevert();
        canary.setGasReserve(400_000);
    }

    /// The bounds' minimums sit above the worst honest quote and leg measured in docs/SPIKES.md S5 (with Monad repricing),
    /// so an owner typo cannot set a cap that strikes those hooks.
    function test_boundsMinimumsCoverTheMeasuredWorstHonestCase() public pure {
        uint256 worstHonestQuoteMonadEstimate = 189_000; // docs/SPIKES.md S5 (pool C, with Monad cold-access repricing)
        uint256 worstHonestLegMonadEstimate = 334_000; // docs/SPIKES.md S5 (pool D, the heaviest non-reverting fixture)
        assertGt(GasBounds.MIN_QUOTE_CAP, worstHonestQuoteMonadEstimate);
        assertGt(GasBounds.MIN_LEG_CAP, worstHonestLegMonadEstimate);
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
