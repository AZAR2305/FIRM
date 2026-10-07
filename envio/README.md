# envio

The FIRM indexer: [Envio HyperIndex](https://docs.envio.dev) on Monad Testnet (chain 10143). It turns contract events into a
GraphQL API (pools, fills, strikes, probes, status history, skips) used by `backend/quote-api`, `backend/bench` (B7) and, later,
the frontend. It is display only: no contract ever reads it.

```
envio/
  config.yaml      contracts and events to index (addresses and start block are generated, see below)
  schema.graphql   entities: Hook, Pool, Fill, Strike, Probe, StatusChange, Skip
  src/EventHandlers.ts   handlers (indexer.onEvent)
  src/lib.ts       pure helpers (flag decoding, shortfall math, bytes32 reason decoding), unit-tested from backend/shared
```

## It must run under WSL 2 / Linux

Envio refuses to start on native Windows. Everything below goes through `scripts/wsl-envio.sh`, which installs Node >= 22.15 under
`~/tools/node`, syncs this folder to `~/firm-envio` in the Linux filesystem, and runs Envio there. Docker Desktop with WSL
integration provides the Postgres and Hasura containers that `envio dev` starts.

```powershell
# from PowerShell on Windows (replace the path with your checkout)
wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-envio.sh codegen     # generate types, validate config + schema + handlers
wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-envio.sh dev-bg      # start the whole stack detached
wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-envio.sh logs 60
wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-envio.sh stop
```

GraphQL (Hasura console and API) is then at <http://localhost:8080> (admin secret `testing` for the local stack).

## Pointing it at a deployment

`config.yaml` is committed with the real testnet PoolManager and zero addresses for FIRM's own contracts. After a deployment:

```bash
node scripts/gen-indexer-config.mjs                  # rewrite addresses + start_block from deployments/10143.json
```

### Data source: HyperSync token or RPC

* **HyperSync** (the default for chain 10143, fastest) needs a free `ENVIO_API_TOKEN` from <https://envio.dev/app/api-tokens>;
  without it Envio stops with "An Envio API token is required for using HyperSync". Put it in `envio/.env`.
* **RPC mode** needs no token. `scripts/gen-indexer-config.mjs --rpc <url>` adds `rpc: [{url, for: sync, initial_block_interval: 100}]`
  (the public testnet RPCs reject `eth_getLogs` ranges above 100 blocks). This is how the local-fork runs work, and it also works
  against `https://testnet-rpc.monad.xyz`.

`scripts/wsl-envio.sh` applies these as environment overlays on the synced copy only, never on the checkout:

| Variable | Effect |
|---|---|
| `ENVIO_DEPLOYMENTS=/mnt/c/.../deployments/10143.fork.json` | addresses and start block from that deployments file |
| `ENVIO_RPC=http://127.0.0.1:8546` | pin the chain to that RPC (`for: sync`) |
| `ENVIO_START_BLOCK=<n>` | start later than the deployment block |

## Local fork workflow

A fork of testnet running inside WSL (so that both Envio and Windows tools can reach it) with a full FIRM deployment:

```powershell
wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-anvil.sh start            # anvil --fork-url https://testnet-rpc.monad.xyz on :8546
cd contracts; $env:FIRM_FORK = "1"; $env:MONAD_TESTNET_RPC_URL = "http://127.0.0.1:8546"; $env:DEPLOYER_PRIVATE_KEY = "<anvil dev key>"; bash script/Redeploy.sh
# writes deployments/10143.fork.json (git-ignored: a fork deployment can never be committed as the real one)
$env:ENVIO_DEPLOYMENTS = "/mnt/c/.../FIRM/deployments/10143.fork.json"; $env:ENVIO_RPC = "http://127.0.0.1:8546"; $env:WSLENV = "ENVIO_DEPLOYMENTS:ENVIO_RPC"
wsl -d Ubuntu -- bash /mnt/c/.../FIRM/scripts/wsl-envio.sh dev-bg
```

Check that the index agrees with the contracts, hook by hook:

```bash
cd backend/bench
FIRM_DEPLOYMENTS_PATH=<path to the fork json> MONAD_TESTNET_RPC_URLS=http://127.0.0.1:8546 \
ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql ENVIO_ADMIN_SECRET=testing pnpm check-indexer
```

## Entities

`Hook` mirrors the Scoreboard's `HookStats` (status, fills, strikes, probes, probeStrikes, cumulative and average shortfall, last
strike, decoded permission flags). Status is only ever taken from `StatusChanged` events, never recomputed. The Scoreboard counts a
**probe strike as a strike** but emits only `ProbeRecorded` for it, so the handler derives the strike counters and a `Strike` row
(id suffix `_probe`) from that event to match the contract.

Events that need no entity of their own (`Rejected`, `NoFill`, `ProbeDone`) are declared so the stream is complete.

## CI

`.github/workflows/ci.yml` runs `npx envio codegen` and `npx tsc --noEmit` on Linux for every push.
