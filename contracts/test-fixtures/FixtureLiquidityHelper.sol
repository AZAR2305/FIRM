// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice TESTNET FIXTURE. Minimal pool seeding helper (adds liquidity through the PoolManager directly).
///         Used by SeedPools.s.sol and the Foundry tests so pools can be seeded identically on a fork,
///         locally and on testnet, without depending on PositionManager/Permit2 plumbing.
contract FixtureLiquidityHelper is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    struct Action {
        PoolKey key;
        ModifyLiquidityParams params;
        address payer;
    }

    error OnlyPoolManager();

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    /// @notice Add `liquidity` over [tickLower, tickUpper], pulling tokens from msg.sender (approve this helper).
    function addLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, uint256 liquidity) external {
        poolManager.unlock(
            abi.encode(
                Action({
                    key: key,
                    params: ModifyLiquidityParams({
                        tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(liquidity), salt: 0
                    }),
                    payer: msg.sender
                })
            )
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        Action memory a = abi.decode(data, (Action));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(a.key, a.params, "");
        _pay(a.key.currency0, delta.amount0(), a.payer);
        _pay(a.key.currency1, delta.amount1(), a.payer);
        return "";
    }

    function _pay(Currency c, int128 amount, address payer) private {
        if (amount < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransferFrom(payer, address(poolManager), uint256(uint128(-amount)));
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(c, payer, uint256(uint128(amount)));
        }
    }
}
