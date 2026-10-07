// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Minimal ABI-compatible slice of Uniswap's IV4Quoter (v4-periphery).
/// @dev Uniswap documents the V4Quoter as revert-based and "not intended for onchain calls".
///      FIRM calls it inside a transaction on purpose (see docs/SPIKES.md S1 for the gas measurements).
///      The Quoter calls the PoolManager as the swap caller, so a hook sees the Quoter's address as
///      `sender` on the quote path and the router's address on the real path.
interface IV4QuoterLite {
    struct QuoteExactSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    function quoteExactInputSingle(QuoteExactSingleParams memory params)
        external
        returns (uint256 amountOut, uint256 gasEstimate);
}
