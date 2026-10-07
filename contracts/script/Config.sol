// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Monad Testnet (10143) addresses, verified against docs.monad.xyz and the Monad hooks guide
///         (spec section 5.2 and 5.3). Uniswap v4 here is Monad-maintained, not an official deployment.
library Config {
    uint256 internal constant CHAIN_ID = 10143;

    address internal constant POOL_MANAGER = 0x451D64ab3b650040d2aE1886602b97ed6eDc643d;
    address internal constant V4_QUOTER = 0x869834d127b230283fe63E0d0A9bEB67216a94C7;
    address internal constant STATE_VIEW = 0xB639209539c61BaF67AC04876315786F8D0b153c;
    address internal constant UNIVERSAL_ROUTER = 0x1b7bFCd2870329B987191910D85c22C7287f3c22;
    address internal constant POSITION_MANAGER = 0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A;

    /// @dev Demo-sized UNRATED cap: fixture hooks all start UNRATED and the demo trades 1,000 tokens.
    uint128 internal constant DEMO_UNRATED_CAP = 10_000e18;

    string internal constant STAGE_DIR = "../deployments/.stage/";
}
