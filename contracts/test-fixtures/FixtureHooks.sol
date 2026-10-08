// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================================
//  QUARANTINED TEST FIXTURES. TESTNET ONLY. NEVER DEPLOY TO MAINNET. NEVER REGISTER ANYWHERE.
//  These hooks misbehave on purpose so the FIRM benchmark can measure detection. They are our own
//  code, so catching them shows the mechanism works, not that real malicious hooks are covered.
// ============================================================================================

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {FixtureHookBase} from "./FixtureHookBase.sol";

/// @notice Takes a constant, disclosed fee identically on the quote and real paths. Must never be struck.
contract FixtureHonestHook is FixtureHookBase {
    uint256 public immutable feeBps;

    constructor(IPoolManager pm, uint256 feeBps_) FixtureHookBase(pm) {
        feeBps = feeBps_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _afterSwapDeltaPermissions();
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        return (IHooks.afterSwap.selector, _takeUnspecifiedFee(key, params, delta, feeBps));
    }
}

/// @notice Quote-spoofing hook (the pattern 0x describes). Honest toward the V4 Quoter, so the quote looks good;
///         takes an extra fee (default about 18%) for any other caller, i.e. on the real execution path.
contract FixtureContextHook is FixtureHookBase {
    address public immutable quoter;
    uint256 public immutable hiddenFeeBps;

    constructor(IPoolManager pm, address quoter_, uint256 hiddenFeeBps_) FixtureHookBase(pm) {
        quoter = quoter_;
        hiddenFeeBps = hiddenFeeBps_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _afterSwapDeltaPermissions();
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        if (sender == quoter) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, _takeUnspecifiedFee(key, params, delta, hiddenFeeBps));
    }
}

/// @notice Probabilistic spoofing: honest toward the Quoter; for every other caller it takes a fee between
///         minFeeBps and maxFeeBps (default 5% to 20%) on a pseudo-random subset of real swaps.
contract FixtureRandomFeeHook is FixtureHookBase {
    address public immutable quoter;
    uint256 public immutable minFeeBps;
    uint256 public immutable maxFeeBps;
    uint256 public nonce;

    constructor(IPoolManager pm, address quoter_, uint256 minFeeBps_, uint256 maxFeeBps_) FixtureHookBase(pm) {
        quoter = quoter_;
        minFeeBps = minFeeBps_;
        maxFeeBps = maxFeeBps_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _afterSwapDeltaPermissions();
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        if (sender == quoter) return (IHooks.afterSwap.selector, 0);
        uint256 r = uint256(keccak256(abi.encode(nonce++, block.timestamp, block.prevrandao, sender)));
        if (r % 2 == 0) return (IHooks.afterSwap.selector, 0);
        uint256 feeBps = minFeeBps + ((r >> 8) % (maxFeeBps - minFeeBps + 1));
        return (IHooks.afterSwap.selector, _takeUnspecifiedFee(key, params, delta, feeBps));
    }
}

/// @notice Honest toward BOTH the Quoter and the FirmRouter; takes a fee from every other caller. The in-tx
///         comparison cannot see it; only CanaryRunner probes (other sender identities) can.
contract FixtureSenderAwareHook is FixtureHookBase {
    address public immutable quoter;
    address public immutable firmRouter;
    uint256 public immutable feeBps;

    constructor(IPoolManager pm, address quoter_, address firmRouter_, uint256 feeBps_) FixtureHookBase(pm) {
        quoter = quoter_;
        firmRouter = firmRouter_;
        feeBps = feeBps_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _afterSwapDeltaPermissions();
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        if (sender == quoter || sender == firmRouter) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, _takeUnspecifiedFee(key, params, delta, feeBps));
    }
}

/// @notice Quotes fine, then burns all available gas on the real path. Tests LEG_GAS_CAP and fallback.
contract FixtureGasGriefHook is FixtureHookBase {
    address public immutable quoter;

    constructor(IPoolManager pm, address quoter_) FixtureHookBase(pm) {
        quoter = quoter_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _beforeSwapPermissions();
    }

    function beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != quoter) {
            assembly ("memory-safe") {
                invalid()
            }
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/// @notice Quotes fine, then reverts on the real path. With `bomb` set it reverts with a huge payload instead,
///         to test that the router never copies attacker-controlled return data.
contract FixtureRevertHook is FixtureHookBase {
    address public immutable quoter;
    bool public immutable bomb;

    constructor(IPoolManager pm, address quoter_, bool bomb_) FixtureHookBase(pm) {
        quoter = quoter_;
        bomb = bomb_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _beforeSwapPermissions();
    }

    function beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != quoter) {
            if (bomb) {
                assembly ("memory-safe") {
                    revert(0, 500000)
                }
            }
            revert("FixtureRevertHook: real path");
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/// @notice (P1) Quotes high only to a simulation (tx.gasprice == 0, i.e. eth_call) and is honest, with a real
///         dynamic fee, inside a real transaction. In-tx quote equals the real fill, so no strike can fire; the
///         `advertisedOut` check (LegSkipped reason 4) is what catches it. Pool must use DYNAMIC_FEE_FLAG.
contract FixtureQuoteOnlyHook is FixtureHookBase {
    uint24 public immutable realFee; // pips, charged in real transactions; simulations get 0

    constructor(IPoolManager pm, uint24 realFee_) FixtureHookBase(pm) {
        realFee = realFee_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _beforeSwapPermissions();
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint24 fee = tx.gasprice == 0 ? 0 : realFee;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}

/// @notice HONEST in output and HEAVY in gas: takes no fee, so the quote equals the fill exactly, but burns a configured
///         amount of gas first, separately for a Quoter call and for a real swap. Used to test the gas caps: a hook like this
///         must never be struck merely for being expensive, and the tests show where the caps nevertheless bite.
contract FixtureHeavyHonestHook is FixtureHookBase {
    address public immutable quoter;
    uint256 public immutable extraGasQuote;
    uint256 public immutable extraGasReal;

    constructor(IPoolManager pm, address quoter_, uint256 extraGasQuote_, uint256 extraGasReal_) FixtureHookBase(pm) {
        quoter = quoter_;
        extraGasQuote = extraGasQuote_;
        extraGasReal = extraGasReal_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return _beforeSwapPermissions();
    }

    function beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 burn = sender == quoter ? extraGasQuote : extraGasReal;
        if (burn != 0) {
            uint256 left = gasleft();
            uint256 stop = left > burn ? left - burn : 0;
            while (gasleft() > stop) {}
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}
