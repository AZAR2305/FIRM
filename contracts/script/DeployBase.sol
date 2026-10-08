// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {HookMiner} from "./HookMiner.sol";
import {Config} from "./Config.sol";

/// @notice Shared plumbing for the deployment scripts.
///
///         Gas: Monad charges the gas LIMIT, so every transaction must carry a deliberate one. Foundry honours `{gas: n}`
///         on a call, but it cannot be given for `new X()` (it would estimate and add a multiplier). So every contract is
///         created with a plain call to the CREATE2 deployer 0x4e59...56C with an explicit limit (`_create2`). A side
///         effect is that addresses are deterministic: they depend on the run id and the init code, not on the nonce.
abstract contract DeployBase is Script {
    /// @dev Optional multiplier (percent) applied to every limit, for a retry after an out-of-gas on the real network.
    function _gas(uint256 limit) internal view returns (uint256) {
        return (limit * vm.envOr("FIRM_GAS_SCALE_PCT", uint256(100))) / 100;
    }

    /// @notice Identifies one deployment. Keeps the CREATE2 addresses of repeated runs on the same chain apart.
    function _runId() internal view returns (bytes32) {
        return vm.envOr("FIRM_RUN_ID", bytes32(0));
    }

    function _salt(string memory name, bytes32 runId) internal pure returns (bytes32) {
        return keccak256(abi.encode("FIRM", runId, name));
    }

    /// @dev Creates `initCode` (creation code ++ constructor args) through the CREATE2 deployer with an explicit gas limit.
    ///      The deployer is `msg.sender` inside the constructor, so contracts must take their owner as an argument.
    function _create2(bytes32 salt, bytes memory initCode, uint256 gasLimit) internal returns (address deployed) {
        deployed = HookMiner.computeAddress(HookMiner.CREATE2_DEPLOYER, salt, keccak256(initCode));
        require(deployed.code.length == 0, "DeployBase: something is already deployed at this salt (set FIRM_RUN_ID)");
        (bool ok,) = HookMiner.CREATE2_DEPLOYER.call{gas: _gas(gasLimit)}(abi.encodePacked(salt, initCode));
        require(ok && deployed.code.length != 0, "DeployBase: CREATE2 deployment failed (out of gas? raise FIRM_GAS_SCALE_PCT)");
    }
}
