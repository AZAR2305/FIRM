// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {Scoreboard} from "../src/Scoreboard.sol";
import {FirmRouter} from "../src/FirmRouter.sol";
import {RawRouter} from "../src/RawRouter.sol";
import {CanaryRunner} from "../src/CanaryRunner.sol";
import {IScoreboard, Params} from "../src/interfaces/IScoreboard.sol";
import {Config} from "./Config.sol";

/// @notice Deploys Scoreboard, FirmRouter, CanaryRunner and RawRouter to Monad Testnet and wires the reporters.
///         Addresses are written to deployments/.stage/core.json (assembled into deployments/10143.json by
///         scripts/build-deployments.mjs after broadcast).
contract Deploy is Script {
    function run() external {
        require(block.chainid == Config.CHAIN_ID, "Deploy: not Monad Testnet (10143)");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        Scoreboard sb = new Scoreboard(deployer);
        FirmRouter router =
            new FirmRouter(IPoolManager(Config.POOL_MANAGER), Config.V4_QUOTER, IScoreboard(address(sb)), deployer);
        CanaryRunner canary =
            new CanaryRunner(IPoolManager(Config.POOL_MANAGER), Config.V4_QUOTER, IScoreboard(address(sb)), deployer);
        RawRouter raw = new RawRouter(IPoolManager(Config.POOL_MANAGER));

        sb.setReporter(address(router), true);
        sb.setReporter(address(canary), true);

        Params memory p = sb.getParams();
        p.unratedCap = Config.DEMO_UNRATED_CAP;
        sb.setParams(p);
        vm.stopBroadcast();

        string memory k = "core";
        vm.serializeAddress(k, "owner", deployer);
        vm.serializeAddress(k, "scoreboard", address(sb));
        vm.serializeAddress(k, "firmRouter", address(router));
        vm.serializeAddress(k, "canaryRunner", address(canary));
        string memory json = vm.serializeAddress(k, "rawRouter", address(raw));
        vm.writeJson(json, string.concat(Config.STAGE_DIR, "core.json"));

        console2.log("Scoreboard   ", address(sb));
        console2.log("FirmRouter   ", address(router));
        console2.log("CanaryRunner ", address(canary));
        console2.log("RawRouter    ", address(raw));
    }
}
