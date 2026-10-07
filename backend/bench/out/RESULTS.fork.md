# FIRM benchmark results

> **LOCAL FORK RUN. These are NOT Monad Testnet measurements.** The RPC was a local anvil fork of testnet state: contract behaviour is real (the deployed PoolManager and V4Quoter), but gas follows Ethereum rules, not Monad's repriced schedule, and block/timing numbers are meaningless. The testnet run replaces this file (`pnpm bench`).

| | |
|---|---|
| Generated | 2026-10-07T06:38:31.437Z |
| Commit | `fdea8f5d5520b52df9e146210aebaf7326f52f90 (+ uncommitted changes)` |
| Chain id | 10143 |
| Blocks | 68899836 to 68900386 |
| Trials per arm | 20 |
| Transactions sent | 550 |
| Duration | 390 s |
| Bench wallet (deployer / owner) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Scoreboard | `0xC0BF43A4Ca27e0976195E6661b099742f10507e5` |
| FirmRouter | `0x43cA9bAe8dF108684E5EAaA720C25e1b32B0A075` |
| RawRouter (unprotected comparator) | `0x59C4e2c6a6dC27c259D6d067a039c831e1ff4947` |
| CanaryRunner | `0x9D3DA37d36BB0B825CD319ed129c2872b893f538` |

## What this does and does not show

- The hooks under test are **our own quarantined fixtures** (`contracts/test-fixtures`). Catching them shows the mechanism works; it does not show that real malicious hooks in the field are caught.
- Between trials the bench owner **reinstates** a BLOCKED hook so each trial is a first encounter. In steady state a blocked hook is skipped, not retried.
- Numbers are reported as measured, including unfavourable ones. Nothing is rounded in our favour.

## Formulas

```
shortfall_bps          = max(0, quoted - settled) * 10000 / quoted
loss_vs_quote_bps      = shortfall_bps of the leg that actually paid the user
loss_vs_best_honest    = (best honest quote - received) / best honest quote * 10000
catch_rate             = strikes_recorded / deviating_executions_attempted
false_positive_rate    = strikes_on_honest_hook / total_honest_executions
```

## B1. Detection by hook

**Method.** For each fixture hook: canary probes (3 amounts x 4 senders, until BLOCKED), then 20 unprotected RawRouter executions (ground truth), then 20 FirmRouter swaps on that single pool with the hook reinstated before each trial. 10-token dust trades.

| Hook | Start status | Probes to BLOCKED | Status after probes | Raw deviating | Router strikes | Router fills | Catch rate (router) |
|---|---|---|---|---|---|---|---|
| B FixtureContextHook | UNRATED | 1 | BLOCKED | 20/20 | 20/20 | 0/20 | 100.0% |
| D FixtureRandomFeeHook | UNRATED | 2 | BLOCKED | 11/20 | 8/20 | 12/20 | n/a (probabilistic hook: compare 11/20 vs 8/20) |
| E FixtureSenderAwareHook | UNRATED | 1 | BLOCKED | 20/20 | 0/20 | 20/20 | 0.0% |
| G FixtureGasGriefHook | UNRATED | 1 | BLOCKED | 20/20 | 20/20 | 0/20 | 100.0% |
| R FixtureRevertHook | UNRATED | 1 | BLOCKED | 20/20 | 20/20 | 0/20 | 100.0% |

**Notes**

- Deviation is measured on the unprotected RawRouter against the Quoter's quote, with a 10 bps tolerance (the NORMAL/UNRATED tolerance).
- FirmRouter trials use a single pool per swap so a rejection is attributable; the hook is reinstated (owner) before each trial so every trial is a first encounter.
- catch rate = strikes recorded / deviating executions, shown for hooks that deviate on every execution. For probabilistic hooks (D) the router trial and the raw trial draw independent randomness, so only the two rates are comparable, and only statistically.
- FixtureSenderAwareHook (E) is honest toward the Quoter and FirmRouter, so the router never strikes it (catch rate 0% through the router); it is caught by canary probes from other sender identities (see probes-to-block and B4).
- Fixtures are our own contracts: this shows the mechanism works, not that real malicious hooks are caught.

## B2. False positives

**Method.** FixtureHonestHook (constant 13 bps fee on every path): 50 canary probes (both directions, 3 amounts, 4 sender identities) plus 50 FirmRouter fills.

| Honest executions | Strikes (target 0) | False-positive rate | Start status | Final status (target NORMAL) | Clean probes | Distinct clean senders |
|---|---|---|---|---|---|---|
| 100 | 0 | 0.00% | UNRATED | NORMAL | 50 | 4 |

**Notes**

- false_positive_rate = strikes on honest hook / total honest executions.
- The honest hook charges the same disclosed fee on the quote and real paths, so quote == settled exactly; the 10 bps tolerance is never needed.
- Honest hooks with legitimate caller-specific discounts could look suspicious and land in WATCH (not tested here).

## B3. User loss

**Method.** 20 swaps of 1000 tUSD through RawRouter (best quote: Pool B) and through FirmRouter [B, C, A], with Pool B quoting best and reinstated before each FirmRouter trial.

**Aggregate**

| Metric | RawRouter (unprotected) | FirmRouter |
|---|---|---|
| Mean loss vs quote | 1799 bps (17.99%) | 0 bps (0.00%) |
| Mean loss vs best honest alternative | 1793 bps (17.93%) | 0 bps (0.00%) |
| Total tokens lost vs quote | 3596.3267 | 0.0000 |
| Pool B rejected by FirmRouter | n/a | 20/20 |

**Per trade (amounts in tUSDC; shortfall in bps; leg = index of the route that filled)**

| # | Quote B | Raw received | Raw shortfall | FIRM received | FIRM shortfall | FIRM leg |
|---|---|---|---|---|---|---|
| 1 | 998.9986 | 819.1788 | 1799 | 998.1987 | 0 | 1 |
| 2 | 998.9966 | 819.1772 | 1799 | 998.1967 | 0 | 1 |
| 3 | 998.9946 | 819.1755 | 1799 | 998.1947 | 0 | 1 |
| 4 | 998.9926 | 819.1739 | 1799 | 998.1927 | 0 | 1 |
| 5 | 998.9906 | 819.1723 | 1799 | 998.1907 | 0 | 1 |
| 6 | 998.9886 | 819.1706 | 1799 | 998.1887 | 0 | 1 |
| 7 | 998.9866 | 819.1690 | 1799 | 998.1867 | 0 | 1 |
| 8 | 998.9846 | 819.1673 | 1799 | 998.1847 | 0 | 1 |
| 9 | 998.9826 | 819.1657 | 1799 | 998.1827 | 0 | 1 |
| 10 | 998.9806 | 819.1641 | 1799 | 998.1807 | 0 | 1 |
| 11 | 998.9786 | 819.1624 | 1799 | 998.1787 | 0 | 1 |
| 12 | 998.9766 | 819.1608 | 1799 | 998.1767 | 0 | 1 |
| 13 | 998.9746 | 819.1592 | 1799 | 998.1747 | 0 | 1 |
| 14 | 998.9726 | 819.1575 | 1799 | 998.1727 | 0 | 1 |
| 15 | 998.9706 | 819.1559 | 1799 | 998.1707 | 0 | 1 |
| 16 | 998.9686 | 819.1543 | 1799 | 998.1687 | 0 | 1 |
| 17 | 998.9666 | 819.1526 | 1799 | 998.1667 | 0 | 1 |
| 18 | 998.9646 | 819.1510 | 1799 | 998.1648 | 0 | 1 |
| 19 | 998.9626 | 819.1493 | 1799 | 998.1628 | 0 | 1 |
| 20 | 998.9606 | 819.1477 | 1799 | 998.1608 | 0 | 1 |

**Notes**

- loss_vs_quote_bps = shortfall_bps of the leg that actually paid the user; loss_vs_best_honest = (best honest quote - received) / best honest quote * 10000, where the best honest alternative is Pool C's quote.
- FirmRouter's loss vs best honest alternative is the price of the honest pool being slightly worse than the spoofed quote, not a hidden fee.
- B is reinstated before each FirmRouter trial, so these are first-encounter results. In steady state B stays BLOCKED and is skipped without being tried.

## B4. Sender-aware hook (why the canary matters)

**Method.** FixtureSenderAwareHook: 20 FirmRouter swaps (router only), then up to 4 CanaryRunner probes from distinct ProbeSender identities.

| Arm | Executions | Strikes recorded | Status after | Detected |
|---|---|---|---|---|
| Start | - | 1 | WATCH | - |
| FirmRouter only | 20/20 filled | 0 | WATCH | no |
| Canary probes | 1 probe(s) | 1 | BLOCKED | yes |

**Notes**

- A determined hook could try to recognise probes (the arXiv paper documents propAMMs penalising callers by address and bytecode fingerprint). This is an arms race, not a solved problem; ProbeSender addresses are deterministic CREATE2 contracts and can be fingerprinted.

## B5. Gas overhead

**Method.** Median of 5 swaps of 100 tUSD through RawRouter and FirmRouter (single route) per pool; plus eth_estimateGas for each (the smallest gas limit that succeeds) and the V4 Quoter's own gas estimate per leg.

| Pool | Raw gas used | FIRM gas used | Used ratio | Raw gas limit needed | FIRM gas limit needed | Limit ratio | Quoter gas / leg | Cost at limit (FIRM vs Raw) |
|---|---|---|---|---|---|---|---|---|
| A (hookless) | 138255 | 195467 | 1.41x | 175004 | 937642 | 5.36x | 43943 | 0.0009 MON vs 0.0001 MON |
| C (honest hook) | 154263 | 260644 | 1.69x | 195014 | 967298 | 4.96x | 71013 | 0.0009 MON vs 0.0001 MON |

**Notes**

- Monad charges gas on the gas LIMIT, not gas used. The 'limit needed' columns (eth_estimateGas) are what a user pays; the ratio of limits is the honest overhead figure. 'Used' ratios understate it.
- Why the limit ratio is far above the used ratio: FirmRouter refuses to start a quote or a leg unless gasleft() covers the gas cap (default 700,000) plus a reserve, so that a starved sub-call can never produce a false strike. The smallest valid gas limit is therefore about 0.9M even though a single protected swap uses about 0.2M. The defaults are deliberately conservative until Monad's repriced schedule has been measured; lowering them with setCaps after the testnet measurement lowers the limit users pay for.
- FIRM adds one in-transaction Quoter call plus Scoreboard bookkeeping per leg. A fallback chain costs more: each rejected leg adds a quote, a reverted leg and a strike write.
- Local anvil forks use Ethereum gas rules, not Monad's repriced schedule, so numbers from a fork are indicative only; the committed testnet numbers are the ones to quote.

## B6. Resilience

**Method.** Hostile hooks as the first route ([hostile, A]) and as the only route ([hostile]). Success means FirmRouter never reverts as a whole, input is refunded or filled elsewhere, and the strike persists.

| Fixture | Whole-tx revert with fallback? | Filled leg | Received (tUSDC) | Hostile leg | Only-route outcome | Input refunded | Strikes added | Status |
|---|---|---|---|---|---|---|---|---|
| FixtureGasGriefHook | no, call succeeded | 1 | 99.7497 | rejected, execFailed=true | NoFill, returned normally | yes, exact | 1 | BLOCKED |
| FixtureRevertHook | no, call succeeded | 1 | 99.7497 | rejected, execFailed=true | NoFill, returned normally | yes, exact | 1 | BLOCKED |

**Notes**

- Each leg runs in a gas-capped self-call and at most 68 bytes of return data are copied, so a hook that burns all gas or reverts (including with a huge payload, covered by the Foundry suite) cannot break the caller.
- Hostile legs consume up to the leg gas cap, which is paid because Monad charges the gas limit: fallback chains cost more than their execution suggests.

## B7. Dashboard latency

_Skipped: ENVIO_GRAPHQL_URL is not set: no indexer to measure._

## B8. Agent arena (scripted trader)

**Method.** 20 trades of varied size (100 to 2,000 tUSD) by a scripted agent that picks the best quote from quote-api: once through RawRouter, once through FirmRouter with the same routes.

**Aggregate**

| Metric | Unprotected agent (RawRouter) | Protected agent (FirmRouter) |
|---|---|---|
| Total loss vs quote (tUSDC) | 190.9961 | 0.0000 |
| Mean shortfall | 99 bps (0.99%) | 0 bps (0.00%) |
| Trades filled | 20/20 | 20/20 |

**Per trade**

| # | tUSD in | Best quote pick | Raw received | Raw shortfall bps | FIRM received | FIRM shortfall bps | FIRM leg |
|---|---|---|---|---|---|---|---|
| 1 | 100 | Q 99.9999 | 98.9999 | 99 | 99.8157 | 0 | 2 |
| 2 | 200 | Q 199.9999 | 197.9999 | 99 | 199.6314 | 0 | 2 |
| 3 | 300 | Q 299.9997 | 296.9997 | 99 | 299.4470 | 0 | 2 |
| 4 | 400 | Q 399.9993 | 395.9993 | 99 | 399.2624 | 0 | 2 |
| 5 | 500 | Q 499.9987 | 494.9987 | 99 | 499.0776 | 0 | 2 |
| 6 | 600 | Q 599.9978 | 593.9978 | 99 | 598.8925 | 0 | 2 |
| 7 | 700 | Q 699.9965 | 692.9966 | 99 | 698.7070 | 0 | 2 |
| 8 | 800 | Q 799.9949 | 791.9949 | 99 | 798.5211 | 0 | 2 |
| 9 | 900 | Q 899.9927 | 890.9928 | 99 | 898.3347 | 0 | 2 |
| 10 | 1000 | Q 999.9900 | 989.9901 | 99 | 998.1478 | 0 | 2 |
| 11 | 1100 | Q 1099.9868 | 1088.9869 | 99 | 1097.9603 | 0 | 2 |
| 12 | 1200 | Q 1199.9828 | 1187.9830 | 99 | 1197.7721 | 0 | 2 |
| 13 | 1300 | Q 1299.9782 | 1286.9784 | 99 | 1297.5832 | 0 | 2 |
| 14 | 1400 | Q 1399.9728 | 1385.9731 | 99 | 1397.3935 | 0 | 2 |
| 15 | 1500 | Q 1499.9665 | 1484.9669 | 99 | 1497.2030 | 0 | 2 |
| 16 | 1600 | Q 1599.9594 | 1583.9598 | 99 | 1597.0116 | 0 | 2 |
| 17 | 1700 | Q 1699.9513 | 1682.9518 | 99 | 1696.8192 | 0 | 2 |
| 18 | 1800 | Q 1799.9422 | 1781.9428 | 99 | 1796.6258 | 0 | 2 |
| 19 | 1900 | Q 1899.9320 | 1880.9327 | 99 | 1896.4314 | 0 | 2 |
| 20 | 100 | Q 99.9962 | 98.9962 | 99 | 99.8119 | 0 | 2 |

**Notes**

- The raw agent picks route 0 from quote-api. On the seeded pools that is the quote-only fixture (best off-chain quote because simulations see a zero fee), whose real-transaction fee differs from its simulated one; FirmRouter skips it with LegSkipped reason 4 (advertisedOut mismatch), then rejects the context hook and fills the honest pool.
- This is a scripted trader, not an LLM agent: the LLM variant (spec M6, P2) is not part of this build.
