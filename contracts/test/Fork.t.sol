// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";

import {FirmRouterTest} from "./FirmRouter.t.sol";

/// @notice Runs the whole FirmRouter suite against a fork of Monad Testnet, using the REAL deployed PoolManager
///         and V4Quoter (Monad-maintained, spec 5.3). Skipped unless MONAD_TESTNET_RPC_URL is set.
///
///   MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract ForkFirmRouterTest
///
/// Note: revm applies Ethereum gas rules, not Monad's, so gas numbers from a fork are indicative only.
contract ForkFirmRouterTest is FirmRouterTest {
    address constant TESTNET_POOL_MANAGER = 0x451D64ab3b650040d2aE1886602b97ed6eDc643d;
    address constant TESTNET_QUOTER = 0x869834d127b230283fe63E0d0A9bEB67216a94C7;

    function setUp() public override {
        string memory rpc = vm.envOr("MONAD_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        uint256 blockNo = vm.envOr("FORK_BLOCK", uint256(0));
        if (blockNo == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNo);
        super.setUp();
    }

    function _newPoolManager() internal pure override returns (IPoolManager) {
        return IPoolManager(TESTNET_POOL_MANAGER);
    }

    function _newQuoter(IPoolManager) internal pure override returns (IV4Quoter) {
        return IV4Quoter(TESTNET_QUOTER);
    }
}
