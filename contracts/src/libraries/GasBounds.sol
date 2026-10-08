// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title GasBounds
/// @notice Hard limits inside which the owner may retune FirmRouter's and CanaryRunner's gas caps and reserve without a
///         redeploy. FORK-MEASURED, NOT MONAD-MEASURED (docs/SPIKES.md S5, docs/GAS.md).
///
///         The lower bounds are the point: a cap below what an honest hook really needs makes the router record that hook
///         as having failed (a leg is "execFailed", a 100% shortfall, SEVERE, BLOCKED on the first occurrence), so the owner
///         must not be able to set one by mistake. Each minimum sits just above the worst honest case measured with Monad's
///         cold-access repricing added (quote 189k, leg 334k; docs/SPIKES.md S5). The maxima keep a chain of MAX_LEGS hostile
///         legs inside one transaction.
library GasBounds {
    uint256 internal constant MIN_QUOTE_CAP = 200_000;
    uint256 internal constant MAX_QUOTE_CAP = 1_000_000;
    uint256 internal constant MIN_LEG_CAP = 350_000;
    uint256 internal constant MAX_LEG_CAP = 1_500_000;
    /// @dev Gas that must remain after a capped call so the router can still write a strike/fill and finish.
    uint256 internal constant MIN_RESERVE = 150_000;
    uint256 internal constant MAX_RESERVE = 1_000_000;

    uint256 internal constant DEFAULT_QUOTE_CAP = 300_000;
    uint256 internal constant DEFAULT_LEG_CAP = 450_000;
    uint256 internal constant DEFAULT_RESERVE = 300_000;

    function capsInBounds(uint256 legCap, uint256 quoteCap) internal pure returns (bool) {
        return legCap >= MIN_LEG_CAP && legCap <= MAX_LEG_CAP && quoteCap >= MIN_QUOTE_CAP && quoteCap <= MAX_QUOTE_CAP;
    }

    function reserveInBounds(uint256 reserve) internal pure returns (bool) {
        return reserve >= MIN_RESERVE && reserve <= MAX_RESERVE;
    }
}
