// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";

import {HookMiner} from "../script/HookMiner.sol";
import {FixtureHonestHook} from "../test-fixtures/FixtureHooks.sol";

contract HookMinerTest is Test {
    function test_minedAddressCarriesExactFlagsAndDeploysViaCreate2() public {
        IPoolManager pm = IPoolManager(address(new PoolManager(address(this))));
        uint160 flags = Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes memory args = abi.encode(pm, uint256(13));
        assertGt(HookMiner.CREATE2_DEPLOYER.code.length, 0, "forge provides the deterministic deployer");
        (address expected, bytes32 salt) =
            HookMiner.find(HookMiner.CREATE2_DEPLOYER, flags, type(FixtureHonestHook).creationCode, args, 0);
        assertEq(uint160(expected) & Hooks.ALL_HOOK_MASK, flags);

        (bool ok,) = HookMiner.CREATE2_DEPLOYER.call(
            abi.encodePacked(salt, abi.encodePacked(type(FixtureHonestHook).creationCode, args))
        );
        assertTrue(ok);
        assertGt(expected.code.length, 0, "deployed at the mined address");
        assertEq(FixtureHonestHook(expected).feeBps(), 13);
    }
}

contract HookMinerAddressTest is Test {
    /// the allocation-free assembly version must equal the textbook CREATE2 formula
    function testFuzz_computeAddressMatchesReference(address deployer, bytes32 salt, bytes32 hash) public pure {
        address ref = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, hash)))));
        assertEq(HookMiner.computeAddress(deployer, salt, hash), ref);
    }
}
