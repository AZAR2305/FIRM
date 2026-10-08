// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// QUARANTINED TEST FIXTURES: testnet only.

import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {MockToken} from "../test-fixtures/MockToken.sol";
import {FixtureLiquidityHelper} from "../test-fixtures/FixtureLiquidityHelper.sol";
import {Config} from "./Config.sol";
import {DeployBase} from "./DeployBase.sol";
import {GasLimits} from "./GasLimits.sol";

/// @notice Initialises the demo pools at 1:1 and seeds each with deep full-range liquidity. Every transaction has an
///         explicit gas limit (GasLimits.sol).
///   A  hookless                       fee 0.25%  baseline, always allowed
///   B  FixtureContextHook             fee 0.10%  quotes the BEST price, hides ~18% on the real path (the villain)
///   C  FixtureHonestHook              fee 0.05%  honest, slightly lower quote than B
///   D  FixtureRandomFeeHook           fee 0.40%  probabilistic spoofing
///   E  FixtureSenderAwareHook         fee 0.50%  honest to Quoter and FirmRouter only (canary value)
///   G  FixtureGasGriefHook            fee 0.60%  burns gas on the real path (resilience, B6)
///   R  FixtureRevertHook              fee 0.70%  reverts on the real path (resilience, B6)
///   Q  FixtureQuoteOnlyHook (dynamic) -          quotes high only to simulations (advertisedOut, P1)
/// Quote order for 1,000 tUSD: B (~999.0) > C (~998.2) > A (~997.5) > D > E > G > R.
contract SeedPools is DeployBase {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant LIQUIDITY = 1e27;

    string internal k = "pools";
    IPoolManager internal pm = IPoolManager(Config.POOL_MANAGER);
    FixtureLiquidityHelper internal helper;
    MockToken internal t0;
    MockToken internal t1;

    function run() external {
        require(block.chainid == Config.CHAIN_ID, "SeedPools: not Monad Testnet (10143)");
        string memory fx = vm.readFile(string.concat(Config.STAGE_DIR, "fixtures.json"));
        MockToken tUSD = MockToken(vm.parseJsonAddress(fx, ".tUSD"));
        MockToken tUSDC = MockToken(vm.parseJsonAddress(fx, ".tUSDC"));
        helper = FixtureLiquidityHelper(vm.parseJsonAddress(fx, ".liquidityHelper"));
        (t0, t1) = address(tUSD) < address(tUSDC) ? (tUSD, tUSDC) : (tUSDC, tUSD);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        // 8 pools x 1e27 of each token
        t0.ownerMint{gas: _gas(GasLimits.OWNER_MINT)}(deployer, 9e27);
        t1.ownerMint{gas: _gas(GasLimits.OWNER_MINT)}(deployer, 9e27);
        t0.approve{gas: _gas(GasLimits.APPROVE)}(address(helper), type(uint256).max);
        t1.approve{gas: _gas(GasLimits.APPROVE)}(address(helper), type(uint256).max);

        _seed("A", address(0), 2500);
        _seed("B", vm.parseJsonAddress(fx, ".hookContext"), 1000);
        _seed("C", vm.parseJsonAddress(fx, ".hookHonest"), 500);
        _seed("D", vm.parseJsonAddress(fx, ".hookRandomFee"), 4000);
        _seed("E", vm.parseJsonAddress(fx, ".hookSenderAware"), 5000);
        _seed("G", vm.parseJsonAddress(fx, ".hookGasGrief"), 6000);
        _seed("R", vm.parseJsonAddress(fx, ".hookRevert"), 7000);
        _seed("Q", vm.parseJsonAddress(fx, ".hookQuoteOnly"), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        vm.stopBroadcast();

        vm.serializeAddress(k, "currency0", address(t0));
        string memory json = vm.serializeAddress(k, "currency1", address(t1));
        vm.writeJson(json, string.concat(Config.STAGE_DIR, "pools.json"));
    }

    function _seed(string memory name, address hook, uint24 fee) internal {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(t0)),
            currency1: Currency.wrap(address(t1)),
            fee: fee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        pm.initialize{gas: _gas(GasLimits.INITIALIZE_POOL)}(key, SQRT_PRICE_1_1);
        helper.addLiquidity{gas: _gas(GasLimits.ADD_LIQUIDITY)}(
            key, TickMath.minUsableTick(TICK_SPACING), TickMath.maxUsableTick(TICK_SPACING), LIQUIDITY
        );

        vm.serializeAddress(k, string.concat(name, "_hook"), hook);
        vm.serializeUint(k, string.concat(name, "_fee"), fee);
        vm.serializeBytes32(k, string.concat(name, "_id"), PoolId.unwrap(key.toId()));
        console2.log(string.concat("pool ", name), hook);
    }
}
