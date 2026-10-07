// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {SwapExecutor} from "./base/SwapExecutor.sol";
import {Route} from "./libraries/RouteLib.sol";
import {QuoteLib} from "./libraries/QuoteLib.sol";
import {SafeCall} from "./libraries/SafeCall.sol";

/// @title ProbeSender
/// @notice A deterministic (CREATE2) swap sender used by CanaryRunner. Each index is a different contract address,
///         so a hook sees a different `sender` for each probe identity. It runs the same quote-then-execute path
///         as FirmRouter (same SwapExecutor, same Quoter) but never reverts on shortfall: it returns
///         (quoted, settled) because the amount is dust.
contract ProbeSender is SwapExecutor {
    using SafeERC20 for IERC20;

    address public immutable runner;
    address public immutable quoter;

    error OnlyRunner();
    error OnlySelf();

    constructor(IPoolManager poolManager_, address quoter_, address runner_) SwapExecutor(poolManager_) {
        quoter = quoter_;
        runner = runner_;
    }

    /// @notice Quote then swap. The runner must already have transferred `amountIn` here. Output and any
    ///         unused input are sent back to the runner.
    /// @return quotedOut in-tx quote (0 = quote failed, nothing executed, input returned)
    /// @return settledOut actual output (0 if the swap failed)
    function run(Route calldata route, uint128 amountIn, uint256 quoteGasCap, uint256 legGasCap)
        external
        returns (uint256 quotedOut, uint256 settledOut)
    {
        if (msg.sender != runner) revert OnlyRunner();
        address tokenIn = Currency.unwrap(route.zeroForOne ? route.key.currency0 : route.key.currency1);
        address tokenOut = Currency.unwrap(route.zeroForOne ? route.key.currency1 : route.key.currency0);

        (quotedOut,) = QuoteLib.tryQuote(quoter, quoteGasCap, route.key, route.zeroForOne, amountIn, route.hookData);

        uint256 used;
        if (quotedOut != 0) {
            bytes memory data = abi.encodeCall(this.exec, (route, amountIn));
            (bool ok, bytes memory ret) = SafeCall.callCapped(address(this), legGasCap, data, 64);
            if (ok && ret.length == 64) (settledOut, used) = abi.decode(ret, (uint256, uint256));
        }

        if (settledOut > 0) IERC20(tokenOut).safeTransfer(runner, settledOut);
        if (used < amountIn) IERC20(tokenIn).safeTransfer(runner, amountIn - used);
    }

    /// @dev Self-call only (so the swap runs in its own gas-capped, revert-isolated frame).
    function exec(Route calldata route, uint128 amountIn) external returns (uint256 out, uint256 used) {
        if (msg.sender != address(this)) revert OnlySelf();
        (out, used) = _swapExactIn(
            Leg({key: route.key, zeroForOne: route.zeroForOne, hookData: route.hookData, amountIn: amountIn})
        );
    }
}
