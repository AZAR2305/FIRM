# FIRM

**Your quote is a promise.** Bonded-quote enforcement and a public fill-quality ledger for Uniswap v4 swaps on Monad.

Monad Metropolis hackathon, **Track 1: Onchain Finance and Trading**. Target network: **Monad Testnet (chain 10143)**. MIT licensed.

## AI-tool disclosure

**AI coding tools were used to build this project.** Specifically **Claude Code** (Anthropic's AI coding agent; recent commits name the model, Claude Sonnet 5.5) working from a written specification ([docs/FIRM-spec.pdf](docs/FIRM-spec.pdf)). Claude Code wrote the contracts, tests, scripts, services, frontend and documentation in this repository; the human team directs, reviews and runs it. The git history shows the build as it happened; the most recent commits carry a `Co-Authored-By` line naming the model, earlier ones do not, but the whole repository was produced this way. The hackathon rules require this disclosure.

## What it is

When you swap tokens, an app shows a quote such as "you will receive about 999 USDC". On Uniswap v4 a pool can attach a **hook**: a contract that runs during the swap and can change the amounts. A badly behaved hook can look good in the quote and take a hidden fee when the swap really executes. Nothing in today's routers remembers which hooks did that, so the next user is hit too.

FIRM turns the quote into a promise. For every swap it asks the pool's V4 Quoter for a quote **inside the same transaction** and then executes at the identical state. If the settled output is below the floor, FIRM reverts only that leg (the user's funds are untouched), writes a **public strike** against the hook, and falls back to the next pool. A separate canary probes hooks with dust swaps from several sender identities before users arrive, and everything lands in an onchain **Scoreboard** that any other router can read.

Inside one transaction the pool's state cannot change except through the pool and its hook, so any difference between the quoted and the settled amount is caused by the hook, not by the market. No oracle, no CEX price, no dispute process.

### The demo, reproduced

The same 1,000 tUSD trade on seeded pools (numbers measured by `contracts/script/DemoSwap.s.sol`, first on a local fork and then **on the public Monad Testnet on 2026-10-11 with the same result**; the pools and the misbehaving hook are our own fixtures):

| Pool | Quote | What really happens |
|---|---|---|
| B: context-spoofing hook | 999.0 (best) | ~18% hidden fee, 819.2 delivered |
| C: honest hook | 998.2 | delivers 998.2 |
| A: no hook | 997.5 | delivers 997.5 |

A naive router picks B and receives **819.18**. FIRM quotes B, executes, sees the shortfall, reverts that leg, strikes B (now `BLOCKED` for every router) and fills C: **998.20**, about 179 tokens saved. On the public testnet that is [raw tx `0xe69c7626...`](https://testnet.monadexplorer.com/tx/0xe69c7626a9133a6de05adab2e06bbfe6bdef8d54648c76a0b38b216548758627) (819.1792) and [FIRM tx `0xbacac567...`](https://testnet.monadexplorer.com/tx/0xbacac567bba50277b376148e21d33ce813ed3b2366d8db2a889885d730a2591e) (Pool B rejected at 1,799 bps and BLOCKED, Pool C filled at 998.1997). One trade, not the 20-trade benchmark.

## Status: what is built and what is verified

| Area | State |
|---|---|
| **contracts/** `Scoreboard`, `FirmRouter`, `RawRouter` (unprotected comparator), `CanaryRunner` + `ProbeSender`, shared `SwapExecutor` | Done. 108 Foundry tests (unit, fuzz, stateful invariants, gas caps), plus the 33-test router suite re-run on a fork of Monad Testnet using the **real deployed PoolManager and V4Quoter** ([docs/SPIKES.md](docs/SPIKES.md)). Gas caps and reserve are owner-configurable within bounds. |
| contracts: quarantined fixtures (honest, heavy-honest, context-spoofing, random-fee, sender-aware, gas-grief, revert, quote-only hooks), mock tokens | Done (`contracts/test-fixtures`, testnet only). |
| contracts: deploy, hook mining, pool seeding, verification, one-command redeploy | **Deployed to Monad Testnet on 2026-10-11** by `Redeploy.sh`: 37 transactions, each with an explicit gas limit, all succeeded; 14 of 14 contracts verified on Sourcify; wiring and all 8 pool quotes checked on-chain. Addresses, blocks and transaction hashes: [DEPLOYMENTS.md](DEPLOYMENTS.md). |
| **backend/** `quote-api` | Done, tested; served from the **Envio index** against a live deployment (`/health` reports `poolSource: envio`). |
| backend: `canary-agent` | Done, tested; probed every fixture hook live (honest hook: 24 clean probes, 0 strikes; the five misbehaving hooks blocked in 1 to 3 probes). |
| backend: `firm-mcp` (MCP tool server) and `trader-agent` (LLM tool-calling loop + scripted fallback + arena) | Done, tested over the real MCP protocol; ran live over stdio MCP against the fork. The 20-trial arena result is the scripted trader (`"mode": "scripted"`, on a fork). A real model (Groq: `qwen/qwen3.8-27b`, `openai/gpt-oss-120b`) also drove the agent on Monad Testnet in a small smoke test (2 trials each, partly failing on bad tool arguments; see `docs/BOUNTIES.md`), and writes the hook summaries on the live site. |
| backend: `bench` (B1 to B8) | Done; a fork run is committed in [backend/bench/out/RESULTS.fork.md](backend/bench/out/RESULTS.fork.md), clearly labelled as not a testnet measurement. |
| **envio/** Envio HyperIndex | **Runs for real under WSL 2 + Docker** (Postgres + Hasura), in **HyperSync mode against the real Monad Testnet** (free `ENVIO_API_TOKEN` in the git-ignored `.env`), pointed at the real deployment: it indexed 8 pools, 7 hooks, the demo swap's fill, strike and BLOCKED status change, and `pnpm check-indexer` reports **agreement with the Scoreboard for all 7 hooks**. Before FIRM existed the index also matched an independent HyperSync count of PoolManager `Initialize` events (70 of 70). Earlier runs on a local fork used RPC mode (HyperSync does not index forks). Small data: one swap. See [envio/README.md](envio/README.md). |
| **Public testnet deployment** | **Done.** [DEPLOYMENTS.md](DEPLOYMENTS.md) lists every address (explorer links), deploy transaction, block and verification status; the deployer spent about 2.29 MON. Real demo swap done (above). **Not run on the public testnet:** the 20-trial benchmark B1 to B8 (about 560 transactions; Monad charges the gas limit and the budget is one funded wallet), the canary agent, and the arena, so those tables in [RESULTS.md](RESULTS.md) stay pending. |
| **frontend/** (Next.js, Tailwind, wagmi v2 + viem) | Done: `/` landing (the business case), `/demo` (guided judge walkthrough), `/swap` (Protected vs Raw, approval step, simulation, receipt-log timeline, cheat picker), `/leaderboard` (Envio-powered, with the source printed), `/hooks/[address]`, `/proof`, `/integrate`, testnet banner with Mint test tokens. A block-explorer link (testnet.monadexplorer.com) after every confirmed mint, approval and swap. Unit tests, a real-browser demo-path test against a local fork that fails on any console error, and a read-only browser test of the build made from the **real** deployment against the **real** testnet. Reads addresses and ABIs only from `deployments/10143.json`; all chain reads go through Multicall3 because the public RPC allows only about 15 requests per second. Not built: `/hooks/[address]`, `/arena`. See [frontend/README.md](frontend/README.md). |
| Gas numbers | **All fork-measured or estimated, none Monad-measured.** Caps, deployment limits and B5 are labelled so everywhere ([docs/SPIKES.md](docs/SPIKES.md) S5). |
| `BondVault`, passkeys, MetaMask plugin | Deferred (P2 in the spec). |

## Architecture

```
   frontend/ (Next.js: /swap /leaderboard /integrate)
        |  reads chain directly with viem; addresses + ABIs from deployments/10143.json
        v
   backend/quote-api  <------ envio/ (HyperIndex, GraphQL) <------ events
        | order routes (same rules the frontend preview uses)         ^
        v                                                            |
 +--------------------- Monad Testnet (10143) ----------------------+
 |  FirmRouter   Scoreboard   CanaryRunner/ProbeSender   RawRouter  |
 |  Uniswap v4 PoolManager + V4Quoter + hooks and pools             |
 +-----------------------------------------------------------------+
        ^                    ^                         ^
 backend/canary-agent   backend/firm-mcp  <--MCP-->  backend/trader-agent
 (probes, reports)      (tools for agents)           (naive trader: LLM or scripted)
```

Contracts make every fund and status decision. The indexer is display only. quote-api only orders candidates (FirmRouter re-quotes and re-checks everything onchain). An LLM, if configured, only writes prose or drives a demo agent whose one swap tool is `firm_swap`.

### One protected swap

1. The caller passes up to 4 candidate routes, best quote first (from quote-api).
2. For each route FirmRouter checks the hook on the Scoreboard: skip `BLOCKED`, cap `UNRATED`.
3. It calls the V4 Quoter **inside the transaction** and computes `floor = quote - tolerance`.
4. It executes the swap in a gas-capped self-call that reverts if output is below the floor, carrying the settled amount in the revert data.
5. On shortfall (or any failure after a good quote) it records a strike in the outer frame and moves on. The swap itself was undone.
6. On success it pays the user and records the fill. If every route fails it refunds the input and returns normally, so the strikes persist.

An optional `advertisedOut` per route (the off-chain quote) additionally skips a hook that quotes differently to an `eth_call` than inside a transaction.

## Repository layout

```
contracts/        Foundry project (solc 0.8.26, cancun)
  src/            FirmRouter, Scoreboard, CanaryRunner, ProbeSender, RawRouter, base/, libraries/, interfaces/
  test-fixtures/  QUARANTINED misbehaving hooks, mock tokens, liquidity helper (testnet only)
  script/         Deploy, DeployFixtures, SeedPools, DemoSwap, HookMiner, Redeploy.sh, Verify.sh
  test/           unit, fuzz, invariant, spike and fork tests
backend/          pnpm workspace (Node 22, viem), see backend/README.md
  shared/         generated ABIs, deployments loader, rate-limited RPC pool, math, hook flags, receipt-writer
  quote-api/      route ordering service
  canary-agent/   dust probes, static analysis, reports
  firm-mcp/       MCP tool server for agents
  trader-agent/   LLM / scripted trader and the arena
  bench/          B1..B8 benchmark runner (writes RESULTS) and the Envio consistency check
envio/            Envio HyperIndex: config.yaml, schema.graphql, handlers (runs under WSL/Linux), see envio/README.md
frontend/         Next.js App Router + Tailwind + wagmi v2 + viem, see frontend/README.md
docs/             DEMO.md (judge flow, video script, reset), BOUNTIES.md, SUBMISSION.md, SPIKES.md, GAS.md, FIRM-spec.pdf
scripts/          deployment assembly, gas budget and report, ABI generation, Envio config generation, WSL helpers (wsl-envio.sh, wsl-anvil.sh), tooling tests
deployments/      10143.json (written by Redeploy.sh; single source of truth for addresses and ABIs)
```

`contracts`, `backend`, `envio` and `frontend` each have their own toolchain and lockfile. They talk only through `deployments/10143.json`,
the contract ABIs and the HTTP/GraphQL APIs.

## Quick start

Prerequisites: Foundry, Node 22, pnpm 10 (and, for Envio on Windows: WSL 2 Ubuntu + Docker Desktop). Clone with submodules:
`git clone --recurse-submodules <repo>`.

```bash
# contracts: unit, fuzz and invariant tests (local PoolManager and the real V4Quoter code)
cd contracts && forge test

# the same router suite against a fork of Monad Testnet (the real deployed PoolManager and Quoter)
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract ForkFirmRouterTest

# backend
cd backend && pnpm install && pnpm -r build && pnpm -r test

# envio (Linux or WSL): validates config + schema + handlers
cd envio && npm install && npx envio codegen

# frontend (builds the "not deployed yet" state until deployments/10143.json exists)
cd frontend && pnpm install && pnpm typecheck && pnpm test && pnpm build && pnpm start   # http://localhost:3000

# deployment tooling guards (gas limits, budget, Redeploy.sh rules)
node --test scripts/test/deploy-tooling.test.mjs
```

### Deploy to Monad Testnet

Needs about **2.83 MON** on the deployer from <https://faucet.monad.xyz> (the faucet is browser-only); the script computes the exact
requirement and refuses to start below it. Monad charges the **gas limit**, so every transaction carries an explicit limit
(`contracts/script/GasLimits.sol`, **fork-measured, not Monad-measured**).

```bash
cp .env.example .env                    # fill in DEPLOYER_PRIVATE_KEY (testnet only), or use a Foundry keystore:
                                        #   cast wallet import firm-deployer --interactive   and set DEPLOYER_ACCOUNT + DEPLOYER_ADDRESS
cd contracts && ./script/Redeploy.sh    # reads ../.env; one command, in this order:
```

1. **Preflight.** Chain id must be 10143; the deployer balance must cover the sum of all gas limits at the live gas price plus 25%.
   Otherwise it stops before sending anything and says who to fund and by how much.
2. `forge build`, then `Deploy` (Scoreboard, FirmRouter, CanaryRunner, RawRouter; reporters wired; demo UNRATED cap), `DeployFixtures`
   (mock tokens, liquidity helper, quarantined hooks at mined CREATE2 addresses), `SeedPools` (pools A to E plus G, R, Q).
3. Writes `deployments/10143.json` (addresses, block numbers, tx hashes, ABIs) and `DEPLOYMENTS.md`.
4. Prints a gas report (limit vs used per transaction) and runs `Verify.sh` (Sourcify / MonadVision). `VERIFY=0` skips it.

After the first real run: commit `deployments/10143.json` and `DEPLOYMENTS.md`, then `node scripts/gen-indexer-config.mjs`. After a
testnet reset, run `Redeploy.sh` again. If a step runs out of gas on the real network, re-run with `FIRM_GAS_SCALE_PCT=150` and then fix
`GasLimits.sol`. **Dry run first** against a local fork (a local RPC is detected automatically and writes git-ignored `*.fork.*` files; see
[deployments/README.md](deployments/README.md)):

```bash
wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-anvil.sh start
cast rpc anvil_setBalance <deployer> 0x56BC75E2D63100000 --rpc-url http://127.0.0.1:8546     # fund it on the FORK only
cd contracts && MONAD_TESTNET_RPC_URL=http://127.0.0.1:8546 ./script/Redeploy.sh
```

Then, with your testnet keys in `.env`:

```bash
cd contracts && forge script script/DemoSwap.s.sol:DemoSwap --rpc-url $MONAD_TESTNET_RPC_URL --account firm-deployer --broadcast --slow
cd ../backend
pnpm quote-api                                   # http://localhost:8787
pnpm canary once                                 # probe every fixture pool, write reports/
pnpm --filter @firm/trader-agent start           # arena: unprotected vs protected agent -> results/arena.json
BENCH_PRIVATE_KEY=0x... pnpm bench               # writes backend/bench/out/RESULTS.testnet.md; copy the numbers into RESULTS.md
cd .. && node scripts/gen-indexer-config.mjs     # point envio/ at the new deployment, then run it (envio/README.md)
cd frontend && pnpm build && pnpm start         # the web app, built from deployments/10143.json
```

### quote-api

`GET /health` (says which pool source answered), `GET /pools?tokenIn&tokenOut`, `POST /route {tokenIn, tokenOut, amountIn, maxLegs?, wallet?}`, `GET /hooks[?status=]`, `GET /hooks/:addr`, `GET /hooks/:addr/report`. Amounts are decimal strings in token base units. The `calldataRoutes` in a `/route` response are exactly what to pass to `FirmRouter.swapExactIn`.

### Using the Scoreboard from another router

```solidity
import {IScoreboard, Status} from "./interfaces/IScoreboard.sol";

Status s = scoreboard.statusOf(hook);          // UNRATED, NORMAL, WATCH, BLOCKED
uint16 tolBps = scoreboard.toleranceBps(hook); // shortfall FIRM would tolerate for this hook right now
```

## Why Monad

FIRM does more work per swap than a plain router: an in-transaction Quoter call and a Scoreboard write for every leg it tries, plus continuous dust probes. That only makes sense where block space is cheap and blocks are fast, so the extra work feels instant and a strike is visible within a block or two. Uniswap v4, whose hooks create the risk we address, is already deployed on Monad Testnet, and the Monad ecosystem has discussed quote spoofing as a hidden cost to traders. The paper on Monad propAMMs (arXiv 2609.38056) proposes exactly the in-transaction query that FIRM implements. So the problem, the fix and the infrastructure are all here, and we deploy everything to Monad Testnet.

To be accurate: Monad charges gas on the gas **limit**, not gas used, so protection is not free and a fallback chain costs more than its execution suggests. We measure it on the limit and report it in [RESULTS.md](RESULTS.md) (measured with `eth_estimateGas` on the public testnet: a protected swap needs a limit **1.44x to 1.77x** an unprotected one, and a first route that burns gas about 1.0M, paid once per hostile hook). FIRM's gas caps exist for this reason, and so does the explicit gas limit on every transaction we send. Monad's fast finality is a property we rely on but have **not** measured here: all timing numbers so far come from a local fork.

## Evidence this addresses (cited as attributed)

- 0x analysed 84,163 Uniswap v4 hooks across 6 chains and classified **54.2% as malicious and a further 26.4% as likely malicious** (19.4% safe), data as of 11 Sep 2026 (0x, "Uniswap v4 hooks were a mistake", 14 Sep 2026). Uniswap's founder disputes the framing, noting the count includes hooks with little activity (via Crypto Briefing). This is 0x's classification, not ours.
- 0x describes hooks that price swaps one way in quote requests and another at settlement, some by inspecting the EVM environment, and says routers need to ensure a pool's quoted amount matches its actual execution. That is exactly FIRM's design goal.
- arXiv 2609.38056 (Solmaz, Heimbach, Milionis) studies Monad propAMMs, not v4 hooks; it suggests an onchain router that queries each venue inside the swap transaction would remove the quote-to-fill gap.
- The Monad hooks guide notes the Universal Router executes the supplied route and does not certify hook safety.

Our own conclusions rest on our own measurements in RESULTS, not on these.

## Known limits

Stated here and in [THREAT_MODEL.md](THREAT_MODEL.md); we do not hide them.

- **Sender-aware hooks.** A hook can behave honestly toward the Quoter and FirmRouter and cheat other callers; FirmRouter caught our fixture of this kind **0 times in 20** (only the canary did). A hook FIRM has cleared may still cheat callers that do not look like FIRM. ([THREAT_MODEL.md](THREAT_MODEL.md) 5.1)
- **Probe recognition is an arms race.** CanaryRunner probes from several deterministic sender contracts, but a determined hook can fingerprint them (the arXiv paper documents propAMMs penalising callers by address and bytecode). Not solved. (5.2)
- **Trusted owner and reporters.** The owner can add reporters that write any record, block or clear a hook, reinstate hooks and retune gas caps (within bounds). It cannot move user funds. No timelock or multisig. (5.3)
- **The gas caps trade false positives against griefing cost.** Too tight, and an honest but heavy hook is BLOCKED on the first occurrence (leg cap) or silently starved of flow (quote cap); too loose, and a hostile hook burns more of the caller's gas. The leg cap is currently 1.35x the heaviest fixture (fork-measured, Monad-adjusted estimate), below our 1.5x policy. Owner-configurable within bounds. (5.4, [docs/SPIKES.md](docs/SPIKES.md) S5)
- FIRM measures **promise-keeping, not price quality**: a hook that is simply expensive but consistent is not struck.
- Honest hooks with legitimate caller-specific discounts may look suspicious and land in WATCH.
- **Fixtures are written by us.** Catching them shows the mechanism works, not that real malicious hooks in the field are caught.
- The V4 Quoter is documented by Uniswap as not intended for onchain calls (revert-based, gas hungry). Spike S1 measured it at roughly 70 to 100k gas per quote on a local EVM; Monad's repricing means this must be re-measured on testnet (`eth_estimateGas`). Caps are owner-tunable within bounds.
- **Gas cost (Monad-measured with `eth_estimateGas` on the public testnet, 2026-10-11).** Monad charges the gas *limit*. A protected swap needs a limit of **1.44x (hookless pool) to 1.77x (honest-hook pool)** an unprotected one: 397k vs 276k and 563k vs 319k. The demo shape [B, C, A] needs about 0.93M and a gas-griefing first route about 1.0M. Monad's numbers are about 1.5x to 1.6x the fork's. Deploying cost about 2.29 MON. Receipts on Monad report gas used equal to the limit, so only estimates can show real usage. Details: [RESULTS.md](RESULTS.md), [docs/GAS.md](docs/GAS.md). An early version needed about 5x because it demanded `cap + reserve` gas up front; it now only blames a failure when the call had its full gas, otherwise it reverts, so low gas can never strike or skip an honest hook. A gas-griefing first route still costs a limit of about 1.0M to 1.3M, paid once per hostile hook. Details, measurements and what is still estimated: [docs/GAS.md](docs/GAS.md).
- Testnet Uniswap v4 here is a Monad-maintained deployment, not an official one, and the testnet can be reset (`Redeploy.sh`).
- Out of scope: MEV and sandwiching, native-token pools, fee-on-transfer tokens, multi-hop routes, split orders.

## Pre-existing code and libraries

Everything in `contracts/src`, `contracts/script`, `contracts/test*`, `backend`, `envio`, `frontend` and `scripts` was written during the hackathon window. Third-party dependencies, unmodified, as git submodules in `contracts/lib`: Uniswap `v4-core` (its `PoolManager` is under the Business Source License 1.1, the interfaces, types and libraries we import are MIT; FIRM deploys no copy of `PoolManager`, it uses the one already deployed on Monad Testnet, and compiles it only inside the local test suite), Uniswap `v4-periphery` (MIT; the `V4Quoter` is likewise only used in tests, production calls go to the deployed Quoter), OpenZeppelin Contracts (MIT) and forge-std (MIT). npm packages are listed in the lockfiles (viem, hono, zod, vitest, tsx, envio; for the frontend next, react, wagmi, tailwindcss, @tanstack/react-query, @playwright/test).

## Licence

MIT. See [LICENSE](LICENSE).
