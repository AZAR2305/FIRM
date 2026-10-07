# deployments

`10143.json` is the **single source of truth for addresses** on Monad Testnet (chain 10143). It is written by
`contracts/script/Redeploy.sh` (through `scripts/build-deployments.mjs`, which merges the Foundry stage files and the
broadcast receipts) and read by `quote-api`, `canary-agent`, `bench` and the indexer config generator. `../DEPLOYMENTS.md`
is generated from it.

There is **no committed `10143.json` yet**: FIRM has not been deployed to the public testnet from this repository (it needs
a funded deployer key). Until then the services stop with a clear "deployments file not found" error. After the first real
deployment, commit `10143.json` and `DEPLOYMENTS.md`.

```bash
cd contracts && DEPLOYER_ACCOUNT=firm-deployer VERIFY=1 ./script/Redeploy.sh
node ../scripts/gen-indexer-config.mjs     # point the indexer at it
```

`.stage/` holds intermediate files from the individual forge scripts and is git-ignored.

To run against a local fork instead of the public testnet (what the committed fork benchmark did):

```bash
anvil --fork-url https://testnet-rpc.monad.xyz --port 8546
MONAD_TESTNET_RPC_URL=http://127.0.0.1:8546 DEPLOYER_PRIVATE_KEY=<anvil dev key> ./script/Redeploy.sh
```

Never commit a `10143.json` produced against a fork: its addresses do not exist on the real testnet.
