// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {SwapExecutor} from "./base/SwapExecutor.sol";
import {Route} from "./libraries/RouteLib.sol";

/// @title RawRouter  (UNPROTECTED COMPARATOR)
/// @notice A deliberately naive router: no quote, no floor, no Scoreboard. It executes one route exactly like an
///         aggregator that trusts the best quote. It exists only for the side-by-side demo and the benchmark.
///         DO NOT USE FOR REAL FUNDS.
contract RawRouter is SwapExecutor, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    event RawSwap(
        bytes32 indexed poolId, address indexed hook, address indexed user, uint256 amountIn, uint256 amountOut
    );

    error MinOutNotMet(uint256 amountOut, uint256 minOut);

    constructor(IPoolManager poolManager_) SwapExecutor(poolManager_) {}

    /// @notice UNPROTECTED: executes `route` with no quote check. Only the caller's own `minOut` applies.
    function swapExactInRaw(Route calldata route, uint128 amountIn, uint128 minOut, address recipient)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        address tokenIn = Currency.unwrap(route.zeroForOne ? route.key.currency0 : route.key.currency1);
        address tokenOut = Currency.unwrap(route.zeroForOne ? route.key.currency1 : route.key.currency0);
        if (tokenIn == address(0) || tokenOut == address(0)) revert NativeCurrencyUnsupported();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 used;
        (amountOut, used) = _swapExactIn(
            Leg({key: route.key, zeroForOne: route.zeroForOne, hookData: route.hookData, amountIn: amountIn})
        );
        if (amountOut < minOut) revert MinOutNotMet(amountOut, minOut);

        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        if (used < amountIn) IERC20(tokenIn).safeTransfer(msg.sender, amountIn - used);
        emit RawSwap(PoolId.unwrap(route.key.toId()), address(route.key.hooks), msg.sender, used, amountOut);
    }
}
