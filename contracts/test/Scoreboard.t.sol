// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Scoreboard} from "../src/Scoreboard.sol";
import {Status, HookStats, Params} from "../src/interfaces/IScoreboard.sol";

contract ScoreboardTest is Test {
    Scoreboard sb;
    address hook = address(0xB00C);
    address other = address(0xB00D);
    bytes32 pid = bytes32(uint256(1));

    event StatusChanged(address indexed hook, Status oldStatus, Status newStatus, bytes32 reason);

    function setUp() public {
        vm.warp(1_000_000);
        sb = new Scoreboard(address(this));
        sb.setReporter(address(this), true);
    }

    function _fill(address h, uint256 n) internal {
        for (uint256 i = 0; i < n; i++) sb.recordFill(h, pid, 1000e18, 1000e18);
    }

    // ------------------------------------------------------------ basics / access
    function test_hooklessIsAlwaysNormal() public view {
        assertEq(uint8(sb.statusOf(address(0))), uint8(Status.NORMAL));
        assertEq(sb.toleranceBps(address(0)), 10);
    }

    function test_newHookIsUnratedWithUnratedTolerance() public view {
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.UNRATED));
        assertEq(sb.toleranceBps(hook), 10);
        assertEq(sb.unratedCap(), 100e18);
    }

    function test_onlyReporterCanWrite() public {
        vm.startPrank(address(0xDEAD));
        vm.expectRevert(Scoreboard.NotReporter.selector);
        sb.recordFill(hook, pid, 1, 1);
        vm.expectRevert(Scoreboard.NotReporter.selector);
        sb.recordStrike(hook, pid, 1, 0, false);
        vm.expectRevert(Scoreboard.NotReporter.selector);
        sb.recordProbe(hook, pid, other, 1, 1, 1);
        vm.stopPrank();
    }

    function test_onlyOwnerAdmin() public {
        Params memory p = sb.getParams();
        vm.startPrank(address(0xDEAD));
        vm.expectRevert();
        sb.setReporter(address(1), true);
        vm.expectRevert();
        sb.setParams(p);
        vm.expectRevert();
        sb.reinstate(hook);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ fills
    function test_cleanFillsCount() public {
        _fill(hook, 3);
        HookStats memory s = sb.stats(hook);
        assertEq(s.fills, 3);
        assertEq(s.cleanStreak, 3);
        assertEq(s.firstSeenAt, 1_000_000);
    }

    function test_unratedBecomesNormalAfter100CleanFills() public {
        _fill(hook, 99);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.UNRATED));
        vm.expectEmit(true, false, false, true);
        emit StatusChanged(hook, Status.UNRATED, Status.NORMAL, "CLEAN_FILLS");
        _fill(hook, 1);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.NORMAL));
    }

    // ------------------------------------------------------------ strikes
    function test_severeStrikeBlocksAtOnce() public {
        // 18% shortfall >= 200 bps
        vm.expectEmit(true, false, false, true);
        emit StatusChanged(hook, Status.UNRATED, Status.BLOCKED, "SEVERE_SHORTFALL");
        sb.recordStrike(hook, pid, 1000e18, 820e18, false);
        HookStats memory s = sb.stats(hook);
        assertEq(uint8(s.status), uint8(Status.BLOCKED));
        assertEq(s.strikes, 1);
        assertEq(s.cleanStreak, 0);
        assertEq(s.cumShortfallBps, 1800);
        assertEq(s.lastStrikeAt, 1_000_000);
    }

    function test_execFailureCountsAsFullShortfallAndBlocks() public {
        sb.recordStrike(hook, pid, 1000e18, 0, true);
        HookStats memory s = sb.stats(hook);
        assertEq(uint8(s.status), uint8(Status.BLOCKED));
        assertEq(s.cumShortfallBps, 10_000);
    }

    function test_execFailureIgnoresSettledAmount() public {
        sb.recordStrike(hook, pid, 1000e18, 999e18, true);
        assertEq(sb.stats(hook).cumShortfallBps, 10_000);
    }

    function test_smallStrikeMovesUnratedToWatch() public {
        // 50 bps < 200 bps severe
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        HookStats memory s = sb.stats(hook);
        assertEq(uint8(s.status), uint8(Status.WATCH));
        assertEq(s.cumShortfallBps, 50);
        assertEq(sb.toleranceBps(hook), 2);
    }

    function test_smallStrikeMovesNormalToWatch() public {
        _fill(hook, 100);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.NORMAL));
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.WATCH));
    }

    function test_threeSmallStrikesInWindowBlock() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.WATCH));
        vm.expectEmit(true, false, false, true);
        emit StatusChanged(hook, Status.WATCH, Status.BLOCKED, "REPEATED_STRIKES");
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.BLOCKED));
        assertEq(sb.stats(hook).recentStrikes, 3);
    }

    function test_strikesOutsideWindowDoNotAccumulate() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        vm.warp(block.timestamp + 3601); // window (3600s) expired
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        HookStats memory s = sb.stats(hook);
        assertEq(s.recentStrikes, 1);
        assertEq(s.strikes, 3);
        assertEq(uint8(s.status), uint8(Status.WATCH));
    }

    function test_strikeAtExactWindowEdgeStillCounts() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        vm.warp(block.timestamp + 3600); // exactly the window: not older than the window
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        assertEq(sb.stats(hook).recentStrikes, 2);
    }

    function test_strikeResetsCleanStreak() public {
        _fill(hook, 50);
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        assertEq(sb.stats(hook).cleanStreak, 0);
    }

    function test_strikeWithZeroQuoteIsFullShortfall() public {
        sb.recordStrike(hook, pid, 0, 0, false);
        assertEq(sb.stats(hook).cumShortfallBps, 10_000);
    }

    function test_strikeOnBlockedStaysBlocked() public {
        sb.recordStrike(hook, pid, 1000e18, 0, true);
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.BLOCKED));
        assertEq(sb.stats(hook).strikes, 2);
    }

    function test_strikesNeverDecrease() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        uint32 before = sb.stats(hook).strikes;
        _fill(hook, 300);
        vm.warp(block.timestamp + 2 days);
        _fill(hook, 300);
        assertGe(sb.stats(hook).strikes, before);
    }

    // ------------------------------------------------------------ WATCH recovery
    function test_watchRecoversAfter200CleanFillsAnd24h() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        vm.warp(block.timestamp + 24 hours);
        _fill(hook, 199);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.WATCH));
        vm.expectEmit(true, false, false, true);
        emit StatusChanged(hook, Status.WATCH, Status.NORMAL, "RECOVERED");
        _fill(hook, 1);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.NORMAL));
    }

    function test_watchDoesNotRecoverBefore24h() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        _fill(hook, 250);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.WATCH));
        vm.warp(block.timestamp + 24 hours);
        _fill(hook, 1); // streak already >= 200 and time satisfied
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.NORMAL));
    }

    function test_watchDoesNotRecoverWithoutEnoughFills() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false);
        vm.warp(block.timestamp + 30 days);
        _fill(hook, 199);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.WATCH));
    }

    // ------------------------------------------------------------ probes
    function test_cleanProbesFromEnoughSendersRateHook() public {
        for (uint160 i = 0; i < 5; i++) sb.recordProbe(hook, pid, address(i + 1), 1e18, 1e18, 1e18);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.UNRATED)); // 5 probes < 6
        vm.expectEmit(true, false, false, true);
        emit StatusChanged(hook, Status.UNRATED, Status.NORMAL, "CLEAN_PROBES");
        sb.recordProbe(hook, pid, address(1), 1e18, 1e18, 1e18);
        HookStats memory s = sb.stats(hook);
        assertEq(uint8(s.status), uint8(Status.NORMAL));
        assertEq(s.probes, 6);
        assertEq(s.cleanProbes, 6);
        assertEq(s.cleanProbeSenders, 5);
    }

    function test_manyProbesFromOneSenderDoNotRate() public {
        for (uint256 i = 0; i < 20; i++) sb.recordProbe(hook, pid, other, 1e18, 1e18, 1e18);
        HookStats memory s = sb.stats(hook);
        assertEq(uint8(s.status), uint8(Status.UNRATED));
        assertEq(s.cleanProbeSenders, 1);
    }

    function test_probeWithinToleranceIsClean() public {
        // 10 bps tolerance: 1000 -> 999 is exactly 10 bps => not above tolerance
        sb.recordProbe(hook, pid, other, 1000e18, 1000e18, 999e18);
        HookStats memory s = sb.stats(hook);
        assertEq(s.cleanProbes, 1);
        assertEq(s.probeStrikes, 0);
        assertEq(s.strikes, 0);
    }

    function test_probeAboveToleranceIsStrike() public {
        sb.recordProbe(hook, pid, other, 1000e18, 1000e18, 998e18); // 20 bps
        HookStats memory s = sb.stats(hook);
        assertEq(s.probeStrikes, 1);
        assertEq(s.strikes, 1);
        assertEq(s.probes, 1);
        assertEq(s.cleanProbes, 0);
        assertEq(uint8(s.status), uint8(Status.WATCH)); // 20 bps < severe
    }

    function test_severeProbeBlocks() public {
        sb.recordProbe(hook, pid, other, 1e18, 1e18, 0.8e18);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.BLOCKED));
    }

    function test_probeUsesWatchToleranceOnWatchHook() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false); // -> WATCH, tol 2 bps
        sb.recordProbe(hook, pid, other, 1000e18, 1000e18, 999e18); // 10 bps > 2 bps
        assertEq(sb.stats(hook).probeStrikes, 1);
    }

    function test_cleanProbesDoNotRateAWatchHook() public {
        sb.recordStrike(hook, pid, 1000e18, 995e18, false); // WATCH
        for (uint160 i = 0; i < 10; i++) sb.recordProbe(hook, pid, address(i + 1), 1e18, 1e18, 1e18);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.WATCH));
    }

    // ------------------------------------------------------------ reinstate
    function test_reinstateMovesBlockedToWatchAndResetsWindow() public {
        sb.recordStrike(hook, pid, 1000e18, 0, true);
        sb.reinstate(hook);
        HookStats memory s = sb.stats(hook);
        assertEq(uint8(s.status), uint8(Status.WATCH));
        assertEq(s.windowStart, 0);
        assertEq(s.recentStrikes, 0);
        assertEq(s.strikes, 1); // history is kept
    }

    function test_reinstateRequiresBlocked() public {
        vm.expectRevert(Scoreboard.NotBlocked.selector);
        sb.reinstate(hook);
    }

    function test_blockedOnlyLeavesViaReinstate() public {
        sb.recordStrike(hook, pid, 1000e18, 0, true);
        _fill(hook, 1000);
        vm.warp(block.timestamp + 365 days);
        _fill(hook, 1000);
        for (uint160 i = 0; i < 10; i++) sb.recordProbe(hook, pid, address(i + 1), 1e18, 1e18, 1e18);
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.BLOCKED));
    }

    function test_blockedToleranceIsZero() public {
        sb.recordStrike(hook, pid, 1000e18, 0, true);
        assertEq(sb.toleranceBps(hook), 0);
    }

    // ------------------------------------------------------------ params
    function test_setParamsWithinBounds() public {
        Params memory p = sb.getParams();
        p.unratedCap = 5000e18;
        p.severeBps = 300;
        sb.setParams(p);
        assertEq(sb.unratedCap(), 5000e18);
        assertEq(sb.getParams().severeBps, 300);
    }

    function test_setParamsRejectsOutOfBounds() public {
        Params memory base = sb.getParams();

        Params memory p = base;
        p.tolNormalBps = 101;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.tolWatchBps = base.tolNormalBps + 1;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.severeBps = 49;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.strikeWindow = 59;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.blockAfterStrikes = 0;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.ratingMinSenders = base.ratingMinProbes + 1;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.unratedCap = 1e18 - 1;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.unratedCap = 1e24 + 1;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);

        p = base;
        p.watchRecoverySeconds = 31 days;
        vm.expectRevert(Scoreboard.ParamOutOfBounds.selector);
        sb.setParams(p);
    }

    function test_paramsChangeAffectsRules() public {
        Params memory p = sb.getParams();
        p.blockAfterStrikes = 1;
        sb.setParams(p);
        sb.recordStrike(hook, pid, 1000e18, 995e18, false); // 50 bps, but 1 strike now blocks
        assertEq(uint8(sb.statusOf(hook)), uint8(Status.BLOCKED));
    }

    // ------------------------------------------------------------ fuzz
    function testFuzz_shortfallBpsMatchesFormula(uint128 quoted, uint128 settled) public {
        vm.assume(quoted > 0);
        sb.recordStrike(hook, pid, quoted, settled, false);
        uint256 expected = settled >= quoted ? 0 : (uint256(quoted - settled) * 10_000) / quoted;
        assertEq(sb.stats(hook).cumShortfallBps, expected);
    }

    function testFuzz_strikesMonotoneAndBlockedIsSticky(uint8 n, uint128 settled) public {
        n = uint8(bound(n, 1, 12));
        bool everBlocked;
        uint32 prevStrikes;
        for (uint8 i = 0; i < n; i++) {
            if (i % 3 == 0) sb.recordFill(hook, pid, 1e18, 1e18);
            sb.recordStrike(hook, pid, 1000e18, settled, false);
            HookStats memory s = sb.stats(hook);
            assertGe(s.strikes, prevStrikes);
            prevStrikes = s.strikes;
            if (s.status == Status.BLOCKED) everBlocked = true;
            if (everBlocked) assertEq(uint8(s.status), uint8(Status.BLOCKED));
        }
    }
}
