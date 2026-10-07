# RESULTS

**Status: no Monad Testnet measurements yet.** FIRM has not been deployed to the public testnet from this repository
(that needs a funded deployer key, see README "Deploy"). The benchmark is built and has been run end to end against a
**local anvil fork of Monad Testnet** (real deployed PoolManager and V4Quoter code and state; local, fresh FIRM
deployment). Those numbers are real for contract behaviour and **not** testnet measurements for gas or timing.

* Full fork run, all experiments: [backend/bench/out/RESULTS.fork.md](backend/bench/out/RESULTS.fork.md)
* Regenerate on testnet: `BENCH_PRIVATE_KEY=0x<deployer key> QUOTE_API_URL=http://localhost:8787 pnpm bench`
  (writes this file, with the exact commit and deployment addresses used)

## Headline numbers from the fork run

Measured, not rounded in our favour. The hooks are our own quarantined fixtures: this shows the mechanism works, not
that real malicious hooks in the field are caught.

| Question | Result (fork run) |
|---|---|
| **B3** User loss on a 1,000 tUSD trade when the best quote is the context-spoofing pool (20 trades) | Unprotected RawRouter: **17.99% loss vs quote** (3,596 tokens over 20 trades). FirmRouter: **0%**, Pool B rejected 20/20 and Pool C filled. |
| **B1** Quote-spoofing hooks (context, gas-grief, revert) through FirmRouter | Struck 20/20 deviating executions, 100% |
| **B1** Probabilistic hook (random 5-20% fee on about half of real swaps) | Deviates on a random subset of real swaps, drawn independently in the raw and router trials, so only the rates are comparable (11/20 raw vs 8/20 router in this run); blocked by canary probe 2 in this run (probe 1 in an earlier run) |
| **B1 / B4** Sender-aware hook (honest to Quoter and router, taxes everyone else) | **Not caught by the router (0%)**, as designed and stated up front; blocked by the first canary probe from another sender identity |
| **B2** False positives, honest hook, 100 executions (50 probes, 50 protected fills) | **0 strikes**, status UNRATED to NORMAL |
| **B6** Gas-grief and reverting hooks | FirmRouter never reverted as a whole; input refunded exactly or filled elsewhere; strike persisted |
| **B8** Scripted agent that always takes the best quote, 20 trades of 100 to 2,000 tUSD | Unprotected: **0.99% mean loss** (191 tokens). With FirmRouter: **0%** |
| **B5** Gas | A single protected swap uses about 1.4x to 1.7x the gas of an unprotected one, but the **gas limit it needs is about 5x** (about 0.9M vs 0.2M), and **Monad charges the limit**. Caused by the conservative 700k default caps; to be re-measured and tuned on testnet. See B5 in the fork results. |
| **B7** Dashboard latency | Skipped: needs a running Envio indexer (not run against a live deployment yet) |

## What would change these numbers

* Testnet gas (Monad's repriced schedule) will change B5, and possibly the right gas caps. A hook that needs more gas
  than the leg cap is treated as failed.
* A real-world hook population may contain hooks that discriminate on the caller; the canary is an arms race, see
  THREAT_MODEL.md.
