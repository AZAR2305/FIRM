# FIRM

**Your quote is a promise.** Bonded-quote enforcement and a public fill-quality ledger for Uniswap v4 swaps on Monad.

Monad Metropolis hackathon, **Track 1: Onchain Finance and Trading**. Target network: **Monad Testnet (chain 10143)**. MIT licensed.

## AI-tool disclosure

This project was built with **Claude Code** (Anthropic's AI coding agent, model Claude Sonnet 5.5) working from a written specification ([docs/FIRM-spec.pdf](docs/FIRM-spec.pdf)). Claude Code wrote the contracts, tests, scripts, services and documentation in this repository; the human team directs, reviews and runs it. The git history shows the build as it happened.

## What it is

When you swap tokens, an app shows a quote such as "you will receive about 999 USDC". On Uniswap v4 a pool can attach a **hook**: a contract that runs during the swap and can change the amounts. A badly behaved hook can look good in the quote and take a hidden fee when the swap really executes. Nothing in today's routers remembers which hooks did that, so the next user is hit too.

FIRM turns the quote into a promise. For every swap it asks the pool's V4 Quoter for a quote **inside the same transaction** and then executes at the identical state. If the settled output is below the floor, FIRM reverts only that leg (the user's funds are untouched), writes a **public strike** against the hook, and falls back to the next pool. A separate canary probes hooks with dust swaps from several sender identities before users arrive, and everything lands in an onchain **Scoreboard** that any other router can read.

Inside one transaction the pool's state cannot change except through the pool and its hook, so any difference between the quoted and the settled amount is caused by the hook, not by the market. No oracle, no CEX price, no dispute process.

### The demo, reproduced

The same 1,000 tUSD trade on seeded testnet pools (numbers measured by `contracts/script/DemoSwap.s.sol`):

| Pool | Quote | What really happens |
|---|---|---|
| B: context-spoofing hook | 999.0 (best) | ~18% hidden fee, 819.2 delivered |
| C: honest hook | 998.2 | delivers 998.2 |
| A: no hook | 997.5 | delivers 997.5 |

A naive router picks B and receives **819.18**. FIRM quotes B, executes, sees the shortfall, reverts that leg, strikes B (now `BLOCKED` for every router) and fills C: **998.20**, about 179 tokens saved.

## Status: what is built and what is verified

| Component | State |
|---|---|
| Contracts: `Scoreboard`, `FirmRouter`, `RawRouter` (unprotected comparator), `CanaryRunner` + `ProbeSender`, shared `SwapExecutor` | Done. 95 Foundry tests (unit, fuzz, stateful invariants), plus the 30-test router suite re-run on a testnet fork. |
| Quarantined fixtures: honest, context-spoofing, random-fee, sender-aware, gas-grief, revert, quote-only hooks; mock tokens | Done (`contracts/test-fixtures`, testnet only). |
| Fork verification | The router suite (30 tests) also passes against a fork of Monad Testnet using the **real deployed PoolManager and V4Quoter**. See [docs/SPIKES.md](docs/SPIKES.md). |
| Deploy scripts, hook mining, pool seeding, verification, one-command redeploy | Done and exercised end to end on an anvil fork of testnet. |
| `quote-api` (Hono + viem): route ordering, Multicall3 quoting, hook endpoints | Done, tested, exercised against the deployed contracts. |
| `canary-agent`: bytecode analysis, probe matrix, idempotent scheduler, reports | Done, tested, exercised against the deployed contracts. |
| Benchmark (`bench/`, B1 to B6, B8; B7 needs the indexer) | Done. A local-fork run is committed in [bench/out/RESULTS.fork.md](bench/out/RESULTS.fork.md), clearly labelled as not a testnet measurement. |
| Envio indexer (`indexer/`) | Written. Its 13 event signatures are cross-checked against the contract ABIs in tests. Envio does not run on Windows, so codegen runs in CI (Linux). **Not yet run against a live deployment.** |
| **Public testnet deployment** | **Not done yet.** It needs a funded deployer key (about 2 MON). See "Deploy". [DEPLOYMENTS.md](DEPLOYMENTS.md) is a placeholder until then. |
| Web app (`apps/web`) | **Not part of this build** (contracts and backend were the scope). The `/swap`, `/leaderboard`, `/integrate` screens of the spec are still to do. |
| `BondVault`, LLM `trader-agent` / `firm-mcp`, Arena, passkeys, MetaMask plugin | Deferred (P2 in the spec). B8 uses a scripted trader instead of an LLM. |

## Architecture

```
            Web app (not in this build)
                 |
                 v
   quote-api (Hono + viem) <---- Envio HyperIndex (GraphQL) <---- events
        | order routes                                              ^
        v                                                           |
 +--------------------- Monad Testnet (10143) -----------------------+
 |  FirmRouter   Scoreboard   CanaryRunner/ProbeSender   RawRouter  |
 |  Uniswap v4 PoolManager + V4Quoter + hooks and pools             |
 +------------------------------------------------------------------+
        ^                                   ^
   canary-agent (probes, reports)      bench (B1..B8 -> RESULTS)
```

Contracts make every fund and status decision. The indexer is display only. quote-api only orders candidates (FirmRouter re-quotes and re-checks everything onchain). An LLM, if configured, only writes prose.

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
indexer/          Envio HyperIndex: config.yaml, schema.graphql, handlers
services/
  shared/         generated ABIs, deployments loader, rate-limited RPC pool, math, hook flags
  quote-api/      route ordering service
  canary-agent/   dust probes, static analysis, reports
bench/            benchmark runner that writes RESULTS
scripts/          deployment assembly, ABI generation, indexer config generation
deployments/      10143.json (written by scripts; single source of truth for addresses)
docs/             SPIKES.md, FIRM-spec.pdf
```

## Quick start

Prerequisites: Foundry, Node 22, pnpm 10. Clone with submodules: `git clone --recurse-submodules <repo>`.

```bash
# contracts: unit, fuzz and invariant tests (local PoolManager and the real V4Quoter code)
cd contracts && forge test

# the same router suite against a fork of Monad Testnet (the real deployed PoolManager and Quoter)
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract ForkFirmRouterTest

# services
pnpm install && pnpm -r build && pnpm -r test
```

### Deploy to Monad Testnet

Needs about 2 MON from <https://faucet.monad.xyz> on the deployer. Gas is charged on the **gas limit**, so scripts keep the estimate multiplier tight.

```bash
cast wallet import firm-deployer --interactive     # never put a key in git
cd contracts
DEPLOYER_ACCOUNT=firm-deployer VERIFY=1 ./script/Redeploy.sh
```

`Redeploy.sh` deploys the contracts, the fixtures and the seeded pools, writes `deployments/10143.json` and `DEPLOYMENTS.md`, and (with `VERIFY=1`) verifies every contract on MonadVision via Sourcify. After a testnet reset, run it again.

Then, with your testnet keys in `.env` (see `.env.example`):

```bash
cd contracts && forge script script/DemoSwap.s.sol:DemoSwap --rpc-url $MONAD_TESTNET_RPC_URL --account firm-deployer --broadcast --slow
pnpm quote-api                      # http://localhost:8787
pnpm canary once                    # probe every fixture pool, write reports/
BENCH_PRIVATE_KEY=0x... pnpm bench  # regenerates RESULTS.md
node scripts/gen-indexer-config.mjs # point the indexer at the new deployment
```

### quote-api

`GET /health`, `GET /pools?tokenIn&tokenOut`, `POST /route {tokenIn, tokenOut, amountIn, maxLegs?, wallet?}`, `GET /hooks[?status=]`, `GET /hooks/:addr`, `GET /hooks/:addr/report`. Amounts are decimal strings in token base units. The `calldataRoutes` in a `/route` response are exactly what to pass to `FirmRouter.swapExactIn`.

### Using the Scoreboard from another router

```solidity
import {IScoreboard, Status} from "./interfaces/IScoreboard.sol";

Status s = scoreboard.statusOf(hook);          // UNRATED, NORMAL, WATCH, BLOCKED
uint16 tolBps = scoreboard.toleranceBps(hook); // shortfall FIRM would tolerate for this hook right now
```

## Why Monad

FIRM compares a pool's quote with its real fill inside a single transaction. Monad's fast block production and finality make that protection feel instant to users, and writing a fill or strike record for every swap and running dust probes continuously is affordable. Uniswap v4, whose hooks create the risk we address, is already deployed on Monad, and the ecosystem has publicly discussed quote spoofing as a hidden cost to traders. We deploy everything to Monad Testnet.

To be accurate: Monad charges gas on the gas **limit**, not gas used, so a fallback chain costs more than its execution suggests. The measured overhead (limit based) is reported in RESULTS, not hidden behind "low fees". FIRM's gas caps (`legGasCap`, `quoteGasCap`) exist for this reason.

## Evidence this addresses (cited as attributed)

- 0x analysed 84,163 Uniswap v4 hooks across 6 chains and classified **54.2% as malicious and a further 26.4% as likely malicious** (19.4% safe), data as of 11 Sep 2026 (0x, "Uniswap v4 hooks were a mistake", 14 Sep 2026). Uniswap's founder disputes the framing, noting the count includes hooks with little activity (via Crypto Briefing). This is 0x's classification, not ours.
- 0x describes hooks that price swaps one way in quote requests and another at settlement, some by inspecting the EVM environment, and says routers need to ensure a pool's quoted amount matches its actual execution. That is exactly FIRM's design goal.
- arXiv 2609.38056 (Solmaz, Heimbach, Milionis) studies Monad propAMMs, not v4 hooks; it suggests an onchain router that queries each venue inside the swap transaction would remove the quote-to-fill gap.
- The Monad hooks guide notes the Universal Router executes the supplied route and does not certify hook safety.

Our own conclusions rest on our own measurements in RESULTS, not on these.

## Known limits

Stated here and in [THREAT_MODEL.md](THREAT_MODEL.md); we do not hide them.

- A hook can behave honestly toward FirmRouter and cheat other callers. CanaryRunner probes from several sender identities, but a determined hook could try to recognise probes (the arXiv paper documents propAMMs penalising callers by address and bytecode fingerprint). This is an arms race, not a solved problem.
- FIRM measures **promise-keeping, not price quality**: a hook that is simply expensive but consistent is not struck.
- Honest hooks with legitimate caller-specific discounts may look suspicious and land in WATCH.
- **Fixtures are written by us.** Catching them shows the mechanism works, not that real malicious hooks in the field are caught.
- The V4 Quoter is documented by Uniswap as not intended for onchain calls (revert-based, gas hungry). Spike S1 measured it at roughly 70 to 100k gas per quote on a local EVM; Monad's repricing means this must be re-measured on testnet (`eth_estimateGas`). Caps are owner-tunable.
- **Gas cost.** Because Monad charges the gas *limit*, and FirmRouter will not start a quote or a leg unless `gasleft()` covers the cap (default 700k each) plus a reserve, a protected swap needs a gas limit of roughly **0.9M** where the unprotected router needs about 0.2M (about 5x at the limit, measured by `eth_estimateGas` in benchmark B5 on a fork; a single protected swap *uses* only about 0.2M). The defaults are deliberately conservative until Monad's repriced gas schedule is measured on testnet; `setCaps` lowers them. Fallback chains cost more again.
- Owner and reporter addresses are trusted roles for the hackathon (centralisation trade-off). The owner cannot move user funds.
- Testnet Uniswap v4 here is a Monad-maintained deployment, not an official one, and the testnet can be reset (`Redeploy.sh`).
- Out of scope: MEV and sandwiching, native-token pools, fee-on-transfer tokens, multi-hop routes, split orders.

## Pre-existing code and libraries

Everything in `contracts/src`, `contracts/script`, `contracts/test*`, `services`, `bench`, `indexer` and `scripts` was written during the hackathon window. Third-party dependencies, unmodified, as git submodules in `contracts/lib`: Uniswap `v4-core` (its `PoolManager` is under the Business Source License 1.1, the interfaces, types and libraries we import are MIT; FIRM deploys no copy of `PoolManager`, it uses the one already deployed on Monad Testnet, and compiles it only inside the local test suite), Uniswap `v4-periphery` (MIT; the `V4Quoter` is likewise only used in tests, production calls go to the deployed Quoter), OpenZeppelin Contracts (MIT) and forge-std (MIT). npm packages are listed in the lockfiles (viem, hono, zod, vitest, tsx, envio).

## Licence

MIT. See [LICENSE](LICENSE).
