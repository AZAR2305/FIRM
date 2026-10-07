// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IScoreboard, Status, HookStats, Params} from "./interfaces/IScoreboard.sol";
import {RouteLib} from "./libraries/RouteLib.sol";

/// @title Scoreboard
/// @notice Public, machine-readable ledger of which Uniswap v4 hooks keep their quotes.
///         Writers are an allow-list of reporters (FirmRouter, CanaryRunner). Anyone can read.
///         Status decisions are fully deterministic; nothing offchain participates.
contract Scoreboard is IScoreboard, Ownable2Step {
    // ------------------------------------------------------------------ events
    event StatusChanged(address indexed hook, Status oldStatus, Status newStatus, bytes32 reason);
    event FillRecorded(address indexed hook, bytes32 indexed poolId, uint256 quotedOut, uint256 settledOut);
    event StrikeRecorded(
        address indexed hook,
        bytes32 indexed poolId,
        uint256 quotedOut,
        uint256 settledOut,
        uint256 shortfallBps,
        bool execFailed
    );
    event ProbeRecorded(
        address indexed hook,
        bytes32 indexed poolId,
        address indexed probeSender,
        uint256 amountIn,
        uint256 quotedOut,
        uint256 settledOut,
        uint256 shortfallBps,
        bool strike
    );
    event ReporterSet(address indexed who, bool allowed);
    event ParamsSet(Params p);
    event Reinstated(address indexed hook);

    // ------------------------------------------------------------------ errors
    error NotReporter();
    error ParamOutOfBounds();
    error NotBlocked();

    // reason codes (bytes32 short strings, decoded by the indexer)
    bytes32 internal constant R_SEVERE = "SEVERE_SHORTFALL";
    bytes32 internal constant R_REPEATED = "REPEATED_STRIKES";
    bytes32 internal constant R_STRIKE = "STRIKE";
    bytes32 internal constant R_RATED_FILLS = "CLEAN_FILLS";
    bytes32 internal constant R_RATED_PROBES = "CLEAN_PROBES";
    bytes32 internal constant R_RECOVERED = "RECOVERED";
    bytes32 internal constant R_REINSTATED = "REINSTATED";

    // ------------------------------------------------------------------ storage
    Params public params;
    mapping(address => bool) public isReporter;
    mapping(address => HookStats) private _stats;
    /// hook => probe sender => already counted as a distinct clean sender
    mapping(address => mapping(address => bool)) public probeSenderSeen;

    modifier onlyReporter() {
        if (!isReporter[msg.sender]) revert NotReporter();
        _;
    }

    constructor(address owner_) Ownable(owner_) {
        params = Params({
            tolNormalBps: 10,
            tolUnratedBps: 10,
            tolWatchBps: 2,
            severeBps: 200,
            strikeWindow: 3600,
            blockAfterStrikes: 3,
            ratingMinProbes: 6,
            ratingMinSenders: 3,
            unratedCleanFills: 100,
            watchRecoveryFills: 200,
            watchRecoverySeconds: 24 hours,
            unratedCap: 100e18
        });
    }

    // ------------------------------------------------------------------ views
    /// @inheritdoc IScoreboard
    function statusOf(address hook) public view returns (Status) {
        if (hook == address(0)) return Status.NORMAL;
        return _stats[hook].status;
    }

    /// @inheritdoc IScoreboard
    function toleranceBps(address hook) public view returns (uint16) {
        Status s = statusOf(hook);
        if (s == Status.NORMAL) return params.tolNormalBps;
        if (s == Status.UNRATED) return params.tolUnratedBps;
        if (s == Status.WATCH) return params.tolWatchBps;
        return 0; // BLOCKED: no shortfall accepted (router skips these anyway)
    }

    /// @inheritdoc IScoreboard
    function unratedCap() external view returns (uint128) {
        return params.unratedCap;
    }

    /// @inheritdoc IScoreboard
    function stats(address hook) external view returns (HookStats memory) {
        return _stats[hook];
    }

    /// @inheritdoc IScoreboard
    function getParams() external view returns (Params memory) {
        return params;
    }

    // ------------------------------------------------------------------ reporter writes
    /// @notice A leg that delivered at least its floor. Counts toward rating and WATCH recovery.
    function recordFill(address hook, bytes32 poolId, uint256 quotedOut, uint256 settledOut) external onlyReporter {
        HookStats storage s = _touch(hook);
        s.fills++;
        s.cleanStreak++;
        emit FillRecorded(hook, poolId, quotedOut, settledOut);

        Params memory p = params;
        if (s.status == Status.WATCH) {
            if (
                s.cleanStreak >= p.watchRecoveryFills
                    && block.timestamp >= uint256(s.lastStrikeAt) + p.watchRecoverySeconds
            ) {
                _setStatus(hook, s, Status.NORMAL, R_RECOVERED);
            }
        } else if (s.status == Status.UNRATED) {
            if (s.cleanStreak >= p.unratedCleanFills) _setStatus(hook, s, Status.NORMAL, R_RATED_FILLS);
        }
    }

    /// @notice A leg that delivered below its floor, or failed after a good quote (execFailed => 100% shortfall).
    function recordStrike(address hook, bytes32 poolId, uint256 quotedOut, uint256 settledOut, bool execFailed)
        external
        onlyReporter
    {
        uint256 shortfall = execFailed ? RouteLib.BPS : RouteLib.shortfallBps(quotedOut, settledOut);
        HookStats storage s = _touch(hook);
        _strike(hook, s, shortfall);
        emit StrikeRecorded(hook, poolId, quotedOut, settledOut, shortfall, execFailed);
    }

    /// @notice Result of a dust probe. A shortfall above the hook's tolerance is a strike; otherwise a clean probe.
    function recordProbe(
        address hook,
        bytes32 poolId,
        address probeSender,
        uint256 amountIn,
        uint256 quotedOut,
        uint256 settledOut
    ) external onlyReporter {
        HookStats storage s = _touch(hook);
        s.probes++;
        uint256 shortfall = RouteLib.shortfallBps(quotedOut, settledOut);
        bool strike = shortfall > toleranceBps(hook);
        emit ProbeRecorded(hook, poolId, probeSender, amountIn, quotedOut, settledOut, shortfall, strike);

        if (strike) {
            s.probeStrikes++;
            _strike(hook, s, shortfall);
            return;
        }

        s.cleanProbes++;
        if (!probeSenderSeen[hook][probeSender]) {
            probeSenderSeen[hook][probeSender] = true;
            s.cleanProbeSenders++;
        }
        Params memory p = params;
        if (
            s.status == Status.UNRATED && s.cleanProbes >= p.ratingMinProbes
                && s.cleanProbeSenders >= p.ratingMinSenders
        ) {
            _setStatus(hook, s, Status.NORMAL, R_RATED_PROBES);
        }
    }

    // ------------------------------------------------------------------ owner
    function setReporter(address who, bool allowed) external onlyOwner {
        isReporter[who] = allowed;
        emit ReporterSet(who, allowed);
    }

    /// @notice Replace parameters. Every field is range-checked.
    function setParams(Params calldata p) external onlyOwner {
        if (
            p.tolNormalBps > 100 || p.tolUnratedBps > 100 || p.tolWatchBps > p.tolNormalBps || p.severeBps < 50
                || p.severeBps > 5000 || p.strikeWindow < 60 || p.strikeWindow > 7 days || p.blockAfterStrikes == 0
                || p.blockAfterStrikes > 20 || p.ratingMinProbes == 0 || p.ratingMinProbes > 100
                || p.ratingMinSenders == 0 || p.ratingMinSenders > p.ratingMinProbes || p.unratedCleanFills == 0
                || p.unratedCleanFills > 10_000 || p.watchRecoveryFills == 0 || p.watchRecoveryFills > 10_000
                || p.watchRecoverySeconds > 30 days || p.unratedCap < 1e18 || p.unratedCap > 1e24
        ) revert ParamOutOfBounds();
        params = p;
        emit ParamsSet(p);
    }

    /// @notice BLOCKED -> WATCH. The only way out of BLOCKED.
    function reinstate(address hook) external onlyOwner {
        HookStats storage s = _stats[hook];
        if (s.status != Status.BLOCKED) revert NotBlocked();
        s.windowStart = 0;
        s.recentStrikes = 0;
        s.cleanStreak = 0;
        _setStatus(hook, s, Status.WATCH, R_REINSTATED);
        emit Reinstated(hook);
    }

    // ------------------------------------------------------------------ internals
    function _touch(address hook) private returns (HookStats storage s) {
        s = _stats[hook];
        if (s.firstSeenAt == 0) s.firstSeenAt = uint64(block.timestamp);
    }

    function _strike(address hook, HookStats storage s, uint256 shortfall) private {
        Params memory p = params;
        s.strikes++;
        s.cleanStreak = 0;
        s.lastStrikeAt = uint64(block.timestamp);
        s.cumShortfallBps += uint128(shortfall);

        if (s.windowStart == 0 || block.timestamp > uint256(s.windowStart) + p.strikeWindow) {
            s.windowStart = uint64(block.timestamp);
            s.recentStrikes = 0;
        }
        s.recentStrikes++;

        if (shortfall >= p.severeBps) {
            _setStatus(hook, s, Status.BLOCKED, R_SEVERE);
        } else if (s.recentStrikes >= p.blockAfterStrikes) {
            _setStatus(hook, s, Status.BLOCKED, R_REPEATED);
        } else if (s.status == Status.UNRATED || s.status == Status.NORMAL) {
            _setStatus(hook, s, Status.WATCH, R_STRIKE);
        }
    }

    function _setStatus(address hook, HookStats storage s, Status to, bytes32 reason) private {
        Status from = s.status;
        if (from == to) return;
        s.status = to;
        emit StatusChanged(hook, from, to, reason);
    }
}
