// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice One candidate pool for a swap, in the order the caller wants it tried.
struct Route {
    PoolKey key;
    bool zeroForOne;
    bytes hookData;
    /// @dev Off-chain quote from quote-api (0 = unused). See FirmRouter ADV_TOL.
    uint128 advertisedOut;
}

/// @title RouteLib
/// @notice Route helpers and basis-point math shared by the router, canary and Scoreboard.
library RouteLib {
    uint256 internal constant BPS = 10_000;

    function currencyIn(Route memory r) internal pure returns (Currency) {
        return r.zeroForOne ? r.key.currency0 : r.key.currency1;
    }

    function currencyOut(Route memory r) internal pure returns (Currency) {
        return r.zeroForOne ? r.key.currency1 : r.key.currency0;
    }

    /// @notice shortfall_bps = max(0, quoted - settled) * 10_000 / quoted. Quote of 0 counts as 100%.
    function shortfallBps(uint256 quoted, uint256 settled) internal pure returns (uint256) {
        if (quoted == 0) return BPS;
        if (settled >= quoted) return 0;
        return ((quoted - settled) * BPS) / quoted;
    }

    /// @notice floor = quoted * (10_000 - tolBps) / 10_000
    function floorOf(uint256 quoted, uint256 tolBps) internal pure returns (uint256) {
        return (quoted * (BPS - tolBps)) / BPS;
    }
}
