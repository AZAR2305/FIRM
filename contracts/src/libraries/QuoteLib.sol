// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IV4QuoterLite} from "../interfaces/IV4QuoterLite.sol";
import {SafeCall} from "./SafeCall.sol";

/// @title QuoteLib
/// @notice Gas-capped, return-data-capped call to the V4 Quoter from inside a transaction.
library QuoteLib {
    /// @return quotedOut 0 on any failure (revert, out of gas, malformed return data)
    /// @return gasEstimate the Quoter's own gas estimate (diagnostic only)
    function tryQuote(
        address quoter,
        uint256 gasCap,
        PoolKey memory key,
        bool zeroForOne,
        uint128 amountIn,
        bytes memory hookData
    ) internal returns (uint256 quotedOut, uint256 gasEstimate) {
        bytes memory data = abi.encodeCall(
            IV4QuoterLite.quoteExactInputSingle,
            (IV4QuoterLite.QuoteExactSingleParams({
                    poolKey: key, zeroForOne: zeroForOne, exactAmount: amountIn, hookData: hookData
                }))
        );
        (bool ok, bytes memory ret) = SafeCall.callCapped(quoter, gasCap, data, 64);
        if (!ok || ret.length < 64) return (0, 0);
        (quotedOut, gasEstimate) = abi.decode(ret, (uint256, uint256));
    }
}
