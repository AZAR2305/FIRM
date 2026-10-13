# RESULTS

Every table below is split into **Fork results** (measured, on a local fork of Monad Testnet) and **Monad Testnet results**
(FIRM was deployed to the public testnet on 2026-10-11, see [DEPLOYMENTS.md](DEPLOYMENTS.md); only what has actually been run there
is filled in, the rest is **pending**). A pending cell means nothing was measured. No fork number is presented as a testnet number.
The testnet budget is small (one funded wallet, about 5 MON), and Monad charges the gas limit, so the 20-trial benchmark
(about 560 transactions) has not been run on the public testnet.

## Read this first

* **The hooks under test are our own fixtures** (`contracts/test-fixtures`): a context-spoofing hook, a random-fee hook, a
  sender-aware hook, gas-grief, revert and quote-only hooks, and an honest hook. Catch rates therefore show that **the mechanism
  works**; they do **not** show that real malicious hooks in the field are caught. We have not measured that and make no such claim.
* **What a fork is.** A local anvil fork of Monad Testnet state: the contract behaviour is real (the deployed PoolManager and V4Quoter
  code and state, plus a fresh FIRM deployment, with a real Envio indexer on top for B7), but **gas follows Ethereum's schedule, not
  Monad's repriced one, and timing numbers say nothing about the network**. Everything labelled "fork-measured" is not Monad-measured.
* Numbers are reported as measured, including unfavourable ones. Nothing is rounded in our favour.
* Sources: the full fork run [backend/bench/out/RESULTS.fork.md](../backend/bench/out/RESULTS.fork.md) (commit `ba2565c` plus uncommitted
  changes, 2026-10-07), the arena [backend/trader-agent/results/arena.fork.json](../backend/trader-agent/results/arena.fork.json)
  (`"mode": "scripted"`: no LLM endpoint was configured, so this is a scripted trader, not a language model), a B5 re-run on 2026-10-08
  after the gas-reserve change (below), and the gas work in [docs/SPIKES.md](SPIKES.md) S5 and [docs/GAS.md](GAS.md).
* Regenerate on testnet (after deploying): `BENCH_PRIVATE_KEY=0x<deployer key> QUOTE_API_URL=http://localhost:8787 pnpm bench` from
  `backend/`. It writes `backend/bench/out/RESULTS.testnet.md` (a fork run writes `RESULTS.fork.md`; neither overwrites this file) with
  the exact commit and deployment addresses used; copy the numbers into the testnet tables below.

## 1. Headline results

### Fork results

| Question | Result (fork) |
|---|---|
| **B3** User loss on a 1,000 tUSD trade when the best quote is the context-spoofing pool (20 trades) | Unprotected RawRouter: **17.99% loss vs quote** (3,596 tokens over 20 trades). FirmRouter: **0%**, Pool B rejected 20/20 and Pool C filled. Single trade: 819.18 vs 998.20 received (DemoSwap, 2026-10-08). |
| **B1** Quote-spoofing hooks (context, gas-grief, revert) through FirmRouter | Struck 20/20 deviating executions (100%) |
| **B1** Probabilistic hook (random 5-20% fee on about half of real swaps) | Deviates on a random subset of real swaps, drawn independently in the raw and router trials, so only the rates are comparable (8/20 raw vs 11/20 router in the full run); blocked by the first canary probes |
| **B1 / B4** Sender-aware hook (honest to Quoter and router, taxes everyone else) | **Not caught by the router (0%)**, as designed and stated up front; blocked by the first canary probe from another sender identity |
| **B2** False positives, honest hook, 100 executions (50 probes, 50 protected fills) | **0 strikes**, status UNRATED to NORMAL |
| **B6** Gas-grief and reverting hooks | FirmRouter never reverted as a whole; input refunded exactly or filled elsewhere; strike persisted |
| **B8 / arena** Agent that always takes the best quote, 20 trades of 100 to 2,000 tUSD (scripted, through the real MCP tool server) | Unprotected: **0.99% mean loss** (191 tokens). With FirmRouter: **0%** hidden loss; its price cost against the best *advertised* quote is about 0.18%, the honest pool's genuinely worse price |
| **B7** Dashboard latency (tx confirmed to Fill queryable in Envio) | p50 **0.97 s**, p95 **1.08 s**, 0 timeouts over 10 swaps. Envio in RPC mode with its default 1 s polling: dominated by the poll interval, says nothing about HyperSync on the real network |
| **Envio vs chain** after the whole run (174 fills, 141 strikes, 104 probes across 7 hooks) | `pnpm check-indexer`: the index agrees with the Scoreboard for all 7 hooks (status, fills, strikes, probes, probe strikes) |

### Monad Testnet results

| Question | Result (Monad Testnet) |
|---|---|
| **Demo swap**, 1,000 tUSD, **one trade** (not the 20-trade B3): raw router vs FirmRouter [B, C, A] | Raw router received **819.1792** (Pool B, hidden fee). FirmRouter: Pool B quoted **998.9970**, delivered **819.1775**, shortfall **1,799 bps (18.0%)**, rejected, struck and moved UNRATED to BLOCKED (`SEVERE_SHORTFALL`); Pool C filled **998.1997**. About **179.02 tokens** saved. Read from the receipts of [raw tx `0xe69c7626...`](https://testnet.monadexplorer.com/tx/0xe69c7626a9133a6de05adab2e06bbfe6bdef8d54648c76a0b38b216548758627) and [FIRM tx `0xbacac567...`](https://testnet.monadexplorer.com/tx/0xbacac567bba50277b376148e21d33ce813ed3b2366d8db2a889885d730a2591e), block 70,067,046 and 70,067,053. Our own fixtures. |
| B3 User loss, raw vs protected, 20 trades | **pending** (one trade only, above) |
| B1 Detection by hook (context, gas-grief, revert, random-fee) | **pending** |
| B1 / B4 Sender-aware hook: router vs canary | **pending** |
| B2 False positives, honest hook | **pending** |
| B6 Gas-grief and reverting hooks | **pending** |
| B8 / arena agent comparison | **pending** (and not yet run with a language model on any network) |
| B7 Dashboard latency | **pending** (HyperSync, real block time) |
| Envio vs chain consistency | **measured, 2026-10-11**: Envio in HyperSync mode on the real deployment (start block 70,065,928) indexed 8 pools, 7 hooks, 1 fill, 1 strike and 1 status change, and `pnpm check-indexer` reported **agreement with the Scoreboard for all 7 hooks** (status, fills, strikes, probes). Earlier the same day, from block 0 before FIRM existed, the index matched an independent HyperSync count of PoolManager `Initialize` events (70 of 70). Small data: one swap's worth of events. |

## 2. B5: gas (what Monad charges is the gas LIMIT)

### Fork results (fork-measured, Ethereum gas schedule, NOT Monad-measured)

`eth_estimateGas` (the smallest limit that succeeds), protected swap of 100 tUSD through a single route vs the unprotected router:

| Pool | Raw limit | FIRM limit, committed run (2026-10-07) | FIRM limit, re-run (2026-10-08) | Ratio, committed | Ratio, re-run |
|---|---|---|---|---|---|
| A, hookless | 175,004 / 175,271 | 240,291 | **243,121** | 1.37x | **1.39x** |
| C, honest hook | 195,014 / 195,237 | 305,468 | **309,251** | 1.57x | **1.58x** |

The re-run is higher by about 3k gas because `gasReserve` became owner-settable (a storage read per capped call) after the committed
run. The committed full run in `backend/bench/out/RESULTS.fork.md` predates that change and was not regenerated; the other experiments
do not depend on this, but it is stated here rather than hidden. Before the gas guard was made failure-attributable the ratios were 5.4x and 5.0x
(docs/GAS.md). A hostile first route (gas-grief) needs a limit of about 1.0M to 1.3M, **estimated** (Monad cold-access repricing added
to fork measurements), paid once per hostile hook.

Gas caps (S5, [docs/SPIKES.md](SPIKES.md)): worst honest quote 189k and worst honest leg 334k with Monad repricing **estimated**, against
caps of 300k and 450k: margins **1.59x** and **1.35x** (the leg margin is below our 1.5x policy; open decision, defaults unchanged).

### Monad Testnet results

| Quantity | Result |
|---|---|
**Measured on the public Monad Testnet on 2026-10-11 with `eth_estimateGas` (the smallest gas limit that succeeds), 100 tUSD, one route.**
These are the numbers a user pays on Monad. They include the 21,000 base cost and calldata.

| Pool | Raw limit | Protected (FirmRouter) limit | Ratio | Same pool on the fork (raw / protected) |
|---|---|---|---|---|
| A, hookless | **276,219** | **397,427** | **1.44x** | 175,271 / 243,121 |
| C, honest hook | **318,983** | **563,354** | **1.77x** | 195,237 / 309,251 |
| B, context hook | 319,144 | 517,566 | 1.62x | not measured on the fork |
| D, random-fee hook | 347,884 | 546,342 | 1.57x | not measured on the fork |
| E, sender-aware hook | 319,229 | 470,109 | 1.47x | not measured on the fork |
| Q, quote-only hook | 265,135 | 434,705 | 1.64x | not measured on the fork |

| Route | Protected limit (Monad) |
|---|---|
| The demo, 1,000 tUSD, routes [B, C, A] (B rejected, C fills) | **927,759** |
| Hostile first route: gas-grief hook G, then A, 100 tUSD | **998,495** (my earlier estimate was 1.0M to 1.3M) |

* Monad's raw swaps cost about **1.5x to 1.6x** what the fork said (A: 276k vs 175k; C: 319k vs 195k). **A first version of the demo script
  used the fork numbers and the raw swap ran out of gas at its 300,000 limit on the real chain**; the limits are now set from these measurements.
* On Monad the protected-to-raw ratio is **1.44x to 1.77x**, wider than the fork's 1.39x to 1.58x for the honest-hook pool.
* **Gas caps against Monad numbers** (`eth_estimateGas` of one Quoter call, 100 tUSD; includes the 21,000 base cost, so it overstates the call):
  worst quote **141,022** (pool C), the others 98k to 117k, against `quoteGasCap` 300,000: margin **at least 2.1x** (my estimate had been 189k).
  The leg is bounded by the raw swap, which also contains two token transfers and the base cost: worst **347,884** (pool D) against
  `legGasCap` 450,000: margin **at least 1.29x**, and larger for the leg alone. Not isolated more precisely: that needs a trace.
* **Receipts on Monad report gas used equal to the gas limit** (all 37 deployment transactions: ratio 1.00), consistent with Monad charging
  the limit. Actual gas usage can therefore **not** be read from receipts there; use `eth_estimateGas` or a trace.

## 3. Deployment cost

### Fork results (fork-measured, NOT Monad-measured)

One run of `Redeploy.sh` (37 transactions: 4 core contracts, 2 tokens, 1 helper, 7 fixture hooks, reporters, 8 pools):

| | Gas |
|---|---|
| Sum of the explicit gas limits (what Monad charges) | 22,200,000 |
| Gas actually used | 14,415,868 (limits are 1.54x used) |
| Cost of the limits at 102 gwei (the live testnet gas price read on 2026-10-08) | about 2.26 MON; the preflight requires 2.83 MON (+25% buffer) |

### Monad Testnet results

| | Result |
|---|---|
| Transactions | **37 sent, 37 succeeded** (4 core contracts, 2 tokens, 1 helper, 7 fixture hooks, 3 owner calls, 2 mints, 2 approvals, 16 pool transactions), Sourcify: **14 of 14 contracts verified** (`exact_match`) |
| Gas limits sent | 22,200,000, each transaction with its own explicit limit; at 102 gwei that is 2.2644 MON |
| MON spent (deployer balance before and after) | **about 2.29 MON** (5.0 to 2.7089; the gas price moved slightly during the run) |
| Did any step run out of gas at its explicit limit? | **No.** All 37 succeeded at limits derived from fork measurements with 1.4x to 1.5x margins, so those margins were sufficient on Monad for the deployment. (Receipts show used = limit, so how much slack remained is unknown.) The first demo swap did run out of gas, see section 2. |

## 4. Gas-cap behaviour tests (local EVM, Ethereum schedule)

These are tests (`contracts/test/GasCaps.t.sol`), not benchmark runs; they pin behaviour.

### Fork / local-EVM results

| Question | Result |
|---|---|
| Honest hook using 2x the typical hook gas | filled, not skipped, not struck |
| Extra gas an honest hook can burn before a cap stops it | 220k per path (5.5x the typical hook); the quote cap binds first, as a silent skip |
| Gas-grief out-of-gas recorded correctly | one strike, `execFailed`, shortfall 10,000 bps, BLOCKED (`SEVERE_SHORTFALL`); the leg burned its 450k cap; the hook is then skipped, not struck twice |
| A cap that is too tight | wrongly BLOCKS an honest heavy hook (leg cap), silently skips it (quote cap) or strikes it through the canary; each is tested and listed in S5 |

### Monad Testnet results

| Question | Result |
|---|---|
| Same behaviour tests against Monad's gas schedule | **pending** (the same tests need the real chain's cost to set the heavy hook's burn) |

## What would change these numbers

* Testnet gas (Monad's repriced schedule) will change B5, the deployment cost and possibly the right gas caps. A hook that needs more
  gas than the leg cap is treated as failed when the leg had its full gas; with a cap that is too tight that is a false strike.
* A real-world hook population may contain hooks that discriminate on the caller; the canary is an arms race, see THREAT_MODEL.md.
* The 20-trial arena has not been run with a language model (a 2-trial smoke test with Groq models on Monad Testnet is in docs/BOUNTIES.md; it is not a benchmark). With an LLM the protected arm should behave identically (the model only chooses
  tools); the unprotected arm could differ if the model decides not to trust the best quote. That has not been measured.
