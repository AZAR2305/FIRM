// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/// @title HookMiner
/// @notice Finds a CREATE2 salt such that the deployed address's low 14 bits equal the hook permission flags
///         exactly (Uniswap v4 requires the address to encode the hook's permissions).
library HookMiner {
    /// @dev Foundry deterministic deployer (CREATE2 factory), the one forge scripts use for `new X{salt: s}()`.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 internal constant MAX_LOOP = 400_000;

    error SaltNotFound();

    /// @dev CREATE2 address. Allocation-free: mining loops call this up to MAX_LOOP times, and an
    ///      `abi.encodePacked` per call would grow memory until the EVM runs out (MemoryOOG) on an unlucky search.
    function computeAddress(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address a) {
        assembly {
            let ptr := mload(0x40) // scratch above the free pointer, never bumped, so it is reused every call
            mstore8(ptr, 0xff)
            mstore(add(ptr, 1), shl(96, deployer))
            mstore(add(ptr, 21), salt)
            mstore(add(ptr, 53), initCodeHash)
            a := and(keccak256(ptr, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }

    /// @param flags the exact permission bits the address must carry in its low 14 bits
    /// @param creationCode `type(Hook).creationCode`
    /// @param constructorArgs `abi.encode(args...)`
    /// @param startSalt first salt to try (lets callers mine several hooks without collisions)
    function find(address deployer, uint160 flags, bytes memory creationCode, bytes memory constructorArgs, uint256 startSalt)
        internal
        view
        returns (address hookAddress, bytes32 salt)
    {
        bytes32 initCodeHash = keccak256(abi.encodePacked(creationCode, constructorArgs));
        for (uint256 i = startSalt; i < startSalt + MAX_LOOP; i++) {
            address a = computeAddress(deployer, bytes32(i), initCodeHash);
            if (uint160(a) & Hooks.ALL_HOOK_MASK == flags && a.code.length == 0) return (a, bytes32(i));
        }
        revert SaltNotFound();
    }
}
