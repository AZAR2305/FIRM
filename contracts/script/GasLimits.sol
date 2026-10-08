// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Explicit gas limit for every transaction the deployment scripts send. Monad charges the gas LIMIT, not the gas
///         used (docs.monad.xyz, gas pricing), so each limit is the measured gas of that step plus a margin, not a
///         generous default.
///
///         FORK-MEASURED, NOT MONAD-MEASURED. "fork used" below is the gas used by that step in one run of Redeploy.sh on a
///         local anvil fork of Monad Testnet (Ethereum's gas schedule; see `node scripts/gas-report.mjs`). Monad reprices cold
///         storage and account access (docs.monad.xyz, opcode pricing), so the real cost can differ. Margins: 1.4x on
///         creates (cost is mostly code deposit, 200 gas per byte, which is not repriced), 1.5x on calls (they touch cold
///         slots, which are). Re-measure after the first real deployment and edit this file. If a step runs out of gas on
///         the real network, re-run with FIRM_GAS_SCALE_PCT=150 (every limit scaled; see DeployBase._gas).
library GasLimits {
    // ---- creates (sent as a call to the CREATE2 deployer, so the limit is explicit)             fork used
    uint256 internal constant CREATE_SCOREBOARD = 2_400_000; //                                     1,700,151
    uint256 internal constant CREATE_FIRM_ROUTER = 2_600_000; //                                    1,839,218
    uint256 internal constant CREATE_CANARY_RUNNER = 2_700_000; //                                  1,917,488
    uint256 internal constant CREATE_RAW_ROUTER = 1_200_000; //                                       836,902
    uint256 internal constant CREATE_MOCK_TOKEN = 900_000; //                                         613,771
    uint256 internal constant CREATE_LIQUIDITY_HELPER = 800_000; //                                   552,219
    uint256 internal constant CREATE_HOOK = 850_000; //            worst of the 7 (FixtureRandomFeeHook) 593,527

    // ---- calls
    uint256 internal constant SET_REPORTER = 80_000; //                                                 47,952
    uint256 internal constant SET_PARAMS = 70_000; //                                                   41,915
    uint256 internal constant OWNER_MINT = 110_000; //                                                  70,348
    uint256 internal constant APPROVE = 70_000; //                                                     46,269
    uint256 internal constant INITIALIZE_POOL = 85_000; //                                              55,775
    uint256 internal constant ADD_LIQUIDITY = 435_000; //        first pool is cold; later pools 256,354 290,314

    // ---- DemoSwap (1,000 tUSD through RawRouter, then through FirmRouter [B rejected, C fills])
    uint256 internal constant PUBLIC_MINT = 80_000; //                                                  33,961
    uint256 internal constant RAW_SWAP = 300_000; //                                                  191,477
    uint256 internal constant FIRM_SWAP = 1_300_000; //   reject B + fill C: 640,102 here; docs/GAS.md puts a hostile first route at 1.0M-1.3M on Monad
}
