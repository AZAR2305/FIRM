// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title SwapExecutor
/// @notice Shared unlock / swap / settle / take path, used by FirmRouter, RawRouter and ProbeSender so the
///         swap code path is identical everywhere (a hook cannot tell the callers apart by *how* they swap).
/// @dev ERC-20 only. The inheriting contract must already hold `amountIn` of the input token.
abstract contract SwapExecutor is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    struct Leg {
        PoolKey key;
        bool zeroForOne;
        bytes hookData;
        uint128 amountIn;
    }

    error OnlyPoolManager();
    error NativeCurrencyUnsupported();
    error InputOverspent(uint256 used, uint256 available);

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    /// @dev Runs one exact-input swap through the PoolManager. Output is taken to address(this).
    /// @return amountOut exact output received (after any hook adjustment)
    /// @return amountInUsed exact input the pool consumed (<= amountIn; the caller refunds the rest)
    function _swapExactIn(Leg memory leg) internal returns (uint256 amountOut, uint256 amountInUsed) {
        bytes memory result = poolManager.unlock(abi.encode(leg));
        (amountOut, amountInUsed) = abi.decode(result, (uint256, uint256));
    }

    /// @inheritdoc IUnlockCallback
    /// @dev Only callable by the PoolManager, and the PoolManager only calls back the address that unlocked it.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        Leg memory leg = abi.decode(data, (Leg));

        Currency cIn = leg.zeroForOne ? leg.key.currency0 : leg.key.currency1;
        Currency cOut = leg.zeroForOne ? leg.key.currency1 : leg.key.currency0;
        if (Currency.unwrap(cIn) == address(0) || Currency.unwrap(cOut) == address(0)) {
            revert NativeCurrencyUnsupported();
        }

        BalanceDelta delta = poolManager.swap(
            leg.key,
            SwapParams({
                zeroForOne: leg.zeroForOne,
                amountSpecified: -int256(uint256(leg.amountIn)),
                sqrtPriceLimitX96: leg.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            leg.hookData
        );

        int128 dIn = leg.zeroForOne ? delta.amount0() : delta.amount1();
        int128 dOut = leg.zeroForOne ? delta.amount1() : delta.amount0();

        uint256 used = dIn < 0 ? uint256(uint128(-dIn)) : 0;
        if (used > leg.amountIn) revert InputOverspent(used, leg.amountIn);
        uint256 out = dOut > 0 ? uint256(uint128(dOut)) : 0;

        // Settle what we owe, take what we are owed. Every delta must net to zero before unlock returns.
        if (dIn < 0) _settle(cIn, used);
        else if (dIn > 0) poolManager.take(cIn, address(this), uint256(uint128(dIn)));
        if (dOut > 0) poolManager.take(cOut, address(this), out);
        else if (dOut < 0) _settle(cOut, uint256(uint128(-dOut)));

        return abi.encode(out, used);
    }

    function _settle(Currency c, uint256 amount) private {
        poolManager.sync(c);
        IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }
}
