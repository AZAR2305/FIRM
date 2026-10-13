# deployments

`10143.json` is the **single source of truth for addresses** on Monad Testnet (chain 10143). It is written by
`contracts/script/Redeploy.sh` (through `scripts/build-deployments.mjs`, which merges the Foundry stage files and the
broadcast receipts) and read by `quote-api`, `canary-agent`, `bench` and the Envio config generator. `../docs/DEPLOYMENTS.md`
is generated from it.

FIRM was deployed to the public testnet on 2026-10-11 (see [`../docs/DEPLOYMENTS.md`](../docs/DEPLOYMENTS.md)), and `10143.json` is committed. After a testnet reset, run `Redeploy.sh` again, then commit `10143.json` and `docs/DEPLOYMENTS.md`.

```bash
cd contracts && ./script/Redeploy.sh        # reads ../.env for DEPLOYER_PRIVATE_KEY / DEPLOYER_ACCOUNT
node ../scripts/gen-indexer-config.mjs      # point envio/ at it
```

`Redeploy.sh` is one command. In order it:

1. **Preflight.** Checks the RPC is chain 10143, reads the live gas price, sums the explicit gas limits of all 37 transactions
   (`contracts/script/GasLimits.sol`, `scripts/gas-budget.mjs`) and refuses to send anything if the deployer holds less than
   that plus a 25% buffer. The message names the deployer, the balance, the amount needed and the shortfall.
2. Builds, then runs `Deploy` (Scoreboard, FirmRouter, CanaryRunner, RawRouter, reporters wired, demo UNRATED cap),
   `DeployFixtures` (mock tokens, liquidity helper, quarantined fixture hooks at mined CREATE2 addresses) and `SeedPools`
   (pools A to E plus G, R, Q).
3. Writes `10143.json` (addresses, block numbers, tx hashes, ABIs) and `docs/DEPLOYMENTS.md`.
4. Prints a gas report (limit versus used per transaction) and runs `Verify.sh` (Sourcify / MonadVision).

**Gas.** Monad charges the gas *limit*, so every transaction carries an explicit one. Calls use `{gas: n}`; contracts are
created with a plain call to the CREATE2 deployer with an explicit limit (Foundry cannot take one for `new X()`), so
addresses depend on the run id, not the nonce. The scripts run with `--skip-simulation`: without it Foundry replaces the
limit of the first transaction of a script by its own estimate. The limits are **fork-measured, not Monad-measured**; if a
step runs out of gas on the real network, re-run with `FIRM_GAS_SCALE_PCT=150` and then update `GasLimits.sol`.

`.stage/` holds intermediate files from the individual forge scripts and is git-ignored.

### Dry run against a local fork (what to do before spending real MON)

```bash
# in WSL (Windows): scripts/wsl-anvil.sh start       -> anvil fork of testnet on :8546
cast rpc anvil_setBalance <deployer> 0x56BC75E2D63100000 --rpc-url http://127.0.0.1:8546   # fund it on the FORK only
cd contracts && MONAD_TESTNET_RPC_URL=http://127.0.0.1:8546 ./script/Redeploy.sh
```

A local RPC switches the script to fork mode by itself (`FIRM_FORK=1`): the outputs are `10143.fork.json` and
`DEPLOYMENTS.fork.md`, both git-ignored, `Verify.sh` only prints what it would verify, and the preflight prices the budget at
the live testnet gas price. Never commit a `10143.json` produced against a fork: its addresses do not exist on the real testnet.
