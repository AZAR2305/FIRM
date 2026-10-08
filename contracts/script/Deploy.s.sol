// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {Scoreboard} from "../src/Scoreboard.sol";
import {FirmRouter} from "../src/FirmRouter.sol";
import {RawRouter} from "../src/RawRouter.sol";
import {CanaryRunner} from "../src/CanaryRunner.sol";
import {IScoreboard, Params} from "../src/interfaces/IScoreboard.sol";
import {Config} from "./Config.sol";
import {DeployBase} from "./DeployBase.sol";
import {GasLimits} from "./GasLimits.sol";

/// @notice Deploys Scoreboard, FirmRouter, CanaryRunner and RawRouter to Monad Testnet and wires the reporters.
///         Addresses are written to deployments/.stage/core.json (assembled into deployments/10143.json by
///         scripts/build-deployments.mjs after broadcast). Every transaction has an explicit gas limit (GasLimits.sol).
contract Deploy is DeployBase {
    function run() external {
        require(block.chainid == Config.CHAIN_ID, "Deploy: not Monad Testnet (10143)");
        bytes32 runId = _runId();
        IPoolManager pm = IPoolManager(Config.POOL_MANAGER);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        Scoreboard sb = Scoreboard(
            _create2(
                _salt("Scoreboard", runId),
                abi.encodePacked(type(Scoreboard).creationCode, abi.encode(deployer)),
                GasLimits.CREATE_SCOREBOARD
            )
        );
        FirmRouter router = FirmRouter(
            _create2(
                _salt("FirmRouter", runId),
                abi.encodePacked(
                    type(FirmRouter).creationCode, abi.encode(pm, Config.V4_QUOTER, IScoreboard(address(sb)), deployer)
                ),
                GasLimits.CREATE_FIRM_ROUTER
            )
        );
        CanaryRunner canary = CanaryRunner(
            _create2(
                _salt("CanaryRunner", runId),
                abi.encodePacked(
                    type(CanaryRunner).creationCode,
                    abi.encode(pm, Config.V4_QUOTER, IScoreboard(address(sb)), deployer)
                ),
                GasLimits.CREATE_CANARY_RUNNER
            )
        );
        RawRouter raw = RawRouter(
            _create2(
                _salt("RawRouter", runId),
                abi.encodePacked(type(RawRouter).creationCode, abi.encode(pm)),
                GasLimits.CREATE_RAW_ROUTER
            )
        );

        sb.setReporter{gas: _gas(GasLimits.SET_REPORTER)}(address(router), true);
        sb.setReporter{gas: _gas(GasLimits.SET_REPORTER)}(address(canary), true);

        Params memory p = sb.getParams();
        p.unratedCap = Config.DEMO_UNRATED_CAP;
        sb.setParams{gas: _gas(GasLimits.SET_PARAMS)}(p);
        vm.stopBroadcast();

        string memory k = "core";
        vm.serializeAddress(k, "owner", deployer);
        vm.serializeBytes32(k, "runId", runId);
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
