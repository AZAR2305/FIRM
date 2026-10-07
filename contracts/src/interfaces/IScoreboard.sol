// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Honesty rating of a hook. Hookless pools are always NORMAL and never stored.
enum Status {
    UNRATED,
    NORMAL,
    WATCH,
    BLOCKED
}

/// @notice Per-hook statistics kept by the Scoreboard.
struct HookStats {
    uint32 fills;
    uint32 strikes;
    uint32 probes;
    uint32 probeStrikes;
    uint32 cleanProbes;
    uint32 cleanStreak;
    uint32 recentStrikes;
    uint16 cleanProbeSenders;
    uint64 windowStart;
    uint64 lastStrikeAt;
    uint64 firstSeenAt;
    uint128 cumShortfallBps;
    Status status;
}

/// @notice Owner-tunable parameters (bounded, see Scoreboard.setParams).
struct Params {
    uint16 tolNormalBps; // allowed shortfall vs in-tx quote for NORMAL hooks
    uint16 tolUnratedBps; // ... for UNRATED hooks
    uint16 tolWatchBps; // ... for WATCH hooks
    uint16 severeBps; // shortfall at or above this blocks at once
    uint32 strikeWindow; // seconds
    uint32 blockAfterStrikes; // strikes inside the window that block
    uint32 ratingMinProbes; // clean probes needed to leave UNRATED
    uint32 ratingMinSenders; // distinct clean probe senders needed
    uint32 unratedCleanFills; // clean streak that moves UNRATED -> NORMAL
    uint32 watchRecoveryFills; // clean streak needed for WATCH -> NORMAL
    uint32 watchRecoverySeconds; // time since last strike needed for WATCH -> NORMAL
    uint128 unratedCap; // max input amount routed through an UNRATED hook
}

/// @title IScoreboard
/// @notice Public ledger of hook honesty. Anyone can read; only allow-listed reporters write.
interface IScoreboard {
    function statusOf(address hook) external view returns (Status);
    function toleranceBps(address hook) external view returns (uint16);
    function unratedCap() external view returns (uint128);
    function stats(address hook) external view returns (HookStats memory);

    // reporter-only
    function recordFill(address hook, bytes32 poolId, uint256 quotedOut, uint256 settledOut) external;
    function recordStrike(address hook, bytes32 poolId, uint256 quotedOut, uint256 settledOut, bool execFailed)
        external;
    function recordProbe(
        address hook,
        bytes32 poolId,
        address probeSender,
        uint256 amountIn,
        uint256 quotedOut,
        uint256 settledOut
    ) external;

    // owner-only
    function setReporter(address who, bool allowed) external;
    function setParams(Params calldata p) external;
    function reinstate(address hook) external;
}
