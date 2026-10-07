// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";


import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {BaseTest} from "./Base.t.sol";
import {Route} from "../src/libraries/RouteLib.sol";

/// @notice Spikes S1-S4 (spec section 15) as executable tests. Results are recorded in docs/SPIKES.md.
///         Run with `forge test --match-contract SpikesTest -vv` to print the gas measurements.
contract SpikesTest is BaseTest {
    PoolKey keyA;
    PoolKey keyC;
    PoolKey keyB;
    address hookC;
    address hookB;

    function setUp() public override {
        super.setUp();
        IPoolManager ipm = IPoolManager(address(pm));
        keyA = _initPool(address(0), 2500);
        hookC = _deployHook("FixtureHooks.sol:FixtureHonestHook", abi.encode(ipm, 13), AFTER_SWAP_DELTA);
        keyC = _initPool(hookC, 500);
        hookB = _deployHook(
            "FixtureHooks.sol:FixtureContextHook", abi.encode(ipm, address(quoter), 1800), AFTER_SWAP_DELTA
        );
        keyB = _initPool(hookB, 1000);
    }

    // ---------------------------------------------------------------- S1
    /// Quoter inside a transaction returns a non-zero amount equal to the real output (within 1 wei) and is cheap.
    function test_S1_quoterInTransaction_matchesRealOutput_andGas() public {
        PoolKey[2] memory keys = [keyA, keyC];
        for (uint256 i = 0; i < 2; i++) {
            uint256 g = gasleft();
            (uint256 q, uint256 est) = quoter.quoteExactInputSingle(
                IV4Quoter.QuoteExactSingleParams({
                    poolKey: keys[i], zeroForOne: true, exactAmount: 1000e18, hookData: ""
                })
            );
            uint256 quoteGas = g - gasleft();
            assertGt(q, 0);

            g = gasleft();
            (uint256 out,) = _swap(_routesOf(keys[i]), 1000e18, 0);
            uint256 swapGas = g - gasleft();

            assertApproxEqAbs(out, q, 1, "quote == real output within 1 wei");
            emit log_named_uint(i == 0 ? "S1 hookless: quote gas" : "S1 honest hook: quote gas", quoteGas);
            emit log_named_uint("   quoter gasEstimate field", est);
            emit log_named_uint("   whole FirmRouter.swapExactIn gas (quote + leg + bookkeeping)", swapGas);
            assertLt(quoteGas, 600_000, "one quote fits the per-leg budget");
            assertLt(swapGas, 1_000_000, "quote + leg fits well under the default caps");
        }
    }

    /// Worst case: a fully failing 4-leg fallback chain still fits comfortably in a block.
    function test_S1_worstCaseFourLegChainGas() public {
        Route[] memory rs = new Route[](4);
        rs[0] = _route(keyB);
        rs[1] = _route(keyB); // second attempt is skipped (BLOCKED)
        rs[2] = _route(keyC);
        rs[3] = _route(keyA);
        uint256 g = gasleft();
        (, int256 leg) = _swap(rs, 1000e18, 0);
        uint256 used = g - gasleft();
        assertEq(leg, 2);
        emit log_named_uint("S1 worst-ish chain (reject B, skip B, fill C) gas", used);
        assertLt(used, 3_000_000);
    }

    function test_S1_gasPerLegWithSpoofingHook() public {
        uint256 g = gasleft();
        _swap(_routes1(keyB), 1000e18, 0); // NoFill: quote + rejected leg + strike
        emit log_named_uint("S1 reject path (quote + failed leg + strike) gas", g - gasleft());
    }

    // ---------------------------------------------------------------- S2
    function test_S2_hookAddressWithFlagsInitialisesAndSwaps() public {
        // keyC's hook lives at an address whose low bits encode AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA
        assertEq(uint160(hookC) & Hooks.ALL_HOOK_MASK, AFTER_SWAP_DELTA);
        (uint256 out, int256 leg) = _swap(_routesOf(keyC), 100e18, 0);
        assertEq(leg, 0);
        assertGt(out, 0);
    }

    // ---------------------------------------------------------------- S4
    function test_S4_hookFlagBitLayout() public pure {
        assertEq(Hooks.BEFORE_SWAP_FLAG, 1 << 7);
        assertEq(Hooks.AFTER_SWAP_FLAG, 1 << 6);
        assertEq(Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG, 1 << 3);
        assertEq(Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG, 1 << 2);
        assertEq(Hooks.BEFORE_ADD_LIQUIDITY_FLAG, 1 << 11);
        assertEq(Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG, 1 << 9);
        // Counter hook of the Monad example: beforeAddLiquidity + beforeRemoveLiquidity + beforeSwap + afterSwap
        assertEq(Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG, 0x0ac0);
    }

    function test_S4_initializeEventSignature() public {
        vm.recordLogs();
        PoolKey memory k = _initPool(address(0), 777);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(pm) && logs[i].topics[0] == sig) {
                found = true;
                assertEq(logs[i].topics.length, 4, "id, currency0, currency1 are indexed");
                assertEq(logs[i].topics[1], _poolId(k));
                assertEq(address(uint160(uint256(logs[i].topics[2]))), address(token0));
                assertEq(address(uint160(uint256(logs[i].topics[3]))), address(token1));
                (uint24 fee, int24 spacing, address hooks, uint160 sqrtP, int24 tick) =
                    abi.decode(logs[i].data, (uint24, int24, address, uint160, int24));
                assertEq(fee, 777);
                assertEq(spacing, TICK_SPACING);
                assertEq(hooks, address(0));
                assertEq(sqrtP, SQRT_PRICE_1_1);
                assertEq(tick, 0);
            }
        }
        assertTrue(found, "Initialize event with the expected topic0 was emitted");
    }

    function _routesOf(PoolKey memory k) internal pure returns (Route[] memory) {
        return _routes1(k);
    }
}
