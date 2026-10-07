// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// QUARANTINED TEST FIXTURES: testnet only. Never deploy to mainnet, never register in any hook list.

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {MockToken} from "../test-fixtures/MockToken.sol";
import {FixtureLiquidityHelper} from "../test-fixtures/FixtureLiquidityHelper.sol";
import {
    FixtureHonestHook,
    FixtureContextHook,
    FixtureRandomFeeHook,
    FixtureSenderAwareHook,
    FixtureGasGriefHook,
    FixtureRevertHook,
    FixtureQuoteOnlyHook
} from "../test-fixtures/FixtureHooks.sol";
import {HookMiner} from "./HookMiner.sol";
import {Config} from "./Config.sol";

/// @notice Deploys the mock tokens (tUSD, tUSDC), the liquidity helper and the quarantined fixture hooks at
///         CREATE2-mined addresses. Requires deployments/.stage/core.json (run Deploy.s.sol first).
contract DeployFixtures is Script {
    uint160 internal constant AFTER_SWAP_DELTA = Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
    uint160 internal constant BEFORE_SWAP = Hooks.BEFORE_SWAP_FLAG;

    /// Demo constants (spec 1.2 / 8.9): hidden fee ~18% on the real path; honest hook fee 13 bps.
    uint256 internal constant HIDDEN_FEE_BPS = 1800;
    uint256 internal constant HONEST_FEE_BPS = 13;
    uint24 internal constant QUOTE_ONLY_REAL_FEE = 10_000; // 1%

    struct Mined {
        address a;
        bytes32 salt;
    }

    address internal firmRouter;
    IPoolManager internal pm = IPoolManager(Config.POOL_MANAGER);

    function _mine(uint160 flags, bytes memory creation, bytes memory args) internal view returns (Mined memory m) {
        (m.a, m.salt) = HookMiner.find(HookMiner.CREATE2_DEPLOYER, flags, creation, args, 0);
    }

    function run() external {
        require(block.chainid == Config.CHAIN_ID, "DeployFixtures: not Monad Testnet (10143)");
        firmRouter = vm.parseJsonAddress(vm.readFile(string.concat(Config.STAGE_DIR, "core.json")), ".firmRouter");
        address quoter = Config.V4_QUOTER;

        // 1) mine salts offchain (runs in the simulation, not as transactions)
        Mined memory b = _mine(
            AFTER_SWAP_DELTA, type(FixtureContextHook).creationCode, abi.encode(pm, quoter, HIDDEN_FEE_BPS)
        );
        Mined memory c =
            _mine(AFTER_SWAP_DELTA, type(FixtureHonestHook).creationCode, abi.encode(pm, HONEST_FEE_BPS));
        Mined memory d =
            _mine(AFTER_SWAP_DELTA, type(FixtureRandomFeeHook).creationCode, abi.encode(pm, quoter, 500, 2000));
        Mined memory e = _mine(
            AFTER_SWAP_DELTA, type(FixtureSenderAwareHook).creationCode, abi.encode(pm, quoter, firmRouter, 500)
        );
        Mined memory g = _mine(BEFORE_SWAP, type(FixtureGasGriefHook).creationCode, abi.encode(pm, quoter));
        Mined memory r = _mine(BEFORE_SWAP, type(FixtureRevertHook).creationCode, abi.encode(pm, quoter, false));
        Mined memory q =
            _mine(BEFORE_SWAP, type(FixtureQuoteOnlyHook).creationCode, abi.encode(pm, QUOTE_ONLY_REAL_FEE));

        // 2) deploy
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        MockToken tUSD = new MockToken("FIRM Test USD", "tUSD", deployer);
        MockToken tUSDC = new MockToken("FIRM Test USDC", "tUSDC", deployer);
        FixtureLiquidityHelper helper = new FixtureLiquidityHelper(pm);

        require(address(new FixtureContextHook{salt: b.salt}(pm, quoter, HIDDEN_FEE_BPS)) == b.a, "B addr");
        require(address(new FixtureHonestHook{salt: c.salt}(pm, HONEST_FEE_BPS)) == c.a, "C addr");
        require(address(new FixtureRandomFeeHook{salt: d.salt}(pm, quoter, 500, 2000)) == d.a, "D addr");
        require(address(new FixtureSenderAwareHook{salt: e.salt}(pm, quoter, firmRouter, 500)) == e.a, "E addr");
        require(address(new FixtureGasGriefHook{salt: g.salt}(pm, quoter)) == g.a, "G addr");
        require(address(new FixtureRevertHook{salt: r.salt}(pm, quoter, false)) == r.a, "R addr");
        require(address(new FixtureQuoteOnlyHook{salt: q.salt}(pm, QUOTE_ONLY_REAL_FEE)) == q.a, "Q addr");
        vm.stopBroadcast();

        // 3) stage output
        string memory k = "fixtures";
        vm.serializeAddress(k, "tUSD", address(tUSD));
        vm.serializeAddress(k, "tUSDC", address(tUSDC));
        vm.serializeAddress(k, "liquidityHelper", address(helper));
        vm.serializeAddress(k, "hookContext", b.a);
        vm.serializeAddress(k, "hookHonest", c.a);
        vm.serializeAddress(k, "hookRandomFee", d.a);
        vm.serializeAddress(k, "hookSenderAware", e.a);
        vm.serializeAddress(k, "hookGasGrief", g.a);
        vm.serializeAddress(k, "hookRevert", r.a);
        string memory json = vm.serializeAddress(k, "hookQuoteOnly", q.a);
        vm.writeJson(json, string.concat(Config.STAGE_DIR, "fixtures.json"));

        console2.log("tUSD", address(tUSD));
        console2.log("tUSDC", address(tUSDC));
        console2.log("B context hook", b.a);
        console2.log("C honest hook", c.a);
    }
}
