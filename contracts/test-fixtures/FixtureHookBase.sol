// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================================
//  QUARANTINED TEST FIXTURE. TESTNET ONLY.
//  Contracts in contracts/test-fixtures intentionally misbehave so FIRM's defences can be
//  measured. Never deploy to mainnet. Never submit to any hook registry or public hook list.
// ============================================================================================

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Shared plumbing for the fixture hooks: PoolManager-only callbacks, permission validation, and a helper
///         that takes a basis-point fee out of the unspecified (output, for exact-input) currency.
abstract contract FixtureHookBase is IHooks {
    IPoolManager public immutable poolManager;

    error NotPoolManager();
    error HookNotImplemented();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    /// @dev Which callbacks this fixture implements. The deployed address must encode exactly these bits.
    function getHookPermissions() public pure virtual returns (Hooks.Permissions memory);

    /// @dev Takes `feeBps` of the unspecified currency's amount into this hook and returns the delta to report.
    function _takeUnspecifiedFee(PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, uint256 feeBps)
        internal
        returns (int128 hookDeltaUnspecified)
    {
        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        int128 unspecified = specifiedIs0 ? delta.amount1() : delta.amount0();
        if (unspecified < 0) unspecified = -unspecified;
        uint256 fee = (uint256(uint128(unspecified)) * feeBps) / 10_000;
        if (fee == 0) return 0;
        Currency c = specifiedIs0 ? key.currency1 : key.currency0;
        poolManager.take(c, address(this), fee);
        return int128(uint128(fee));
    }

    // ---- unimplemented callbacks ------------------------------------------------------------
    function beforeInitialize(address, PoolKey calldata, uint160) external virtual returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external virtual returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external virtual returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external virtual returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        virtual
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        virtual
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    /// @dev Permissions struct for "afterSwap that returns a delta" hooks.
    function _afterSwapDeltaPermissions() internal pure returns (Hooks.Permissions memory p) {
        p.afterSwap = true;
        p.afterSwapReturnDelta = true;
    }

    /// @dev Permissions struct for "beforeSwap only" hooks.
    function _beforeSwapPermissions() internal pure returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
    }
}
