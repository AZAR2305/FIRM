# RESULTS

**Status: no Monad Testnet measurements yet.** FIRM has not been deployed to the public testnet from this repository
(that needs a funded deployer wallet, see README "Deploy"). The benchmark, the agents and the Envio indexer have been run end
to end against a **local anvil fork of Monad Testnet running in WSL** (the real deployed PoolManager and V4Quoter code and
state, plus a fresh FIRM deployment, with a real Envio indexer on top). Those numbers are real for contract behaviour and
**not** testnet measurements for gas or timing.

* Full fork run, all experiments B1 to B8: [backend/bench/out/RESULTS.fork.md](backend/bench/out/RESULTS.fork.md)
* Arena (unprotected vs protected agent, 20 trades): [backend/trader-agent/results/arena.fork.json](backend/trader-agent/results/arena.fork.json)
  (`"mode": "scripted"`: no LLM endpoint was configured, so this is the scripted trader, not a language model)
* Regenerate on testnet: `BENCH_PRIVATE_KEY=0x<deployer key> QUOTE_API_URL=http://localhost:8787 pnpm bench` from `backend/`
  (writes this file, with the exact commit and deployment addresses used)

## Headline numbers from the fork run

Measured, not rounded in our favour. The hooks are our own quarantined fixtures: this shows the mechanism works, not
that real malicious hooks in the field are caught.

| Question | Result (fork run) |
|---|---|
| **B3** User loss on a 1,000 tUSD trade when the best quote is the context-spoofing pool (20 trades) | Unprotected RawRouter: **17.99% loss vs quote** (3,596 tokens over 20 trades). FirmRouter: **0%**, Pool B rejected 20/20 and Pool C filled. |
| **B1** Quote-spoofing hooks (context, gas-grief, revert) through FirmRouter | Struck 20/20 deviating executions, 100% |
| **B1** Probabilistic hook (random 5-20% fee on about half of real swaps) | Deviates on a random subset of real swaps, drawn independently in the raw and router trials, so only the rates are comparable (10/20 raw vs 11/20 router in this run); blocked by the first canary probe |
| **B1 / B4** Sender-aware hook (honest to Quoter and router, taxes everyone else) | **Not caught by the router (0%)**, as designed and stated up front; blocked by the first canary probe from another sender identity |
| **B2** False positives, honest hook, 100 executions (50 probes, 50 protected fills) | **0 strikes**, status UNRATED to NORMAL |
| **B6** Gas-grief and reverting hooks | FirmRouter never reverted as a whole; input refunded exactly or filled elsewhere; strike persisted |
| **B8 / arena** Agent that always takes the best quote, 20 trades of 100 to 2,000 tUSD (scripted, through the real MCP tool server) | Unprotected: **0.99% mean loss** (191 tokens). With FirmRouter: **0%** hidden loss; its price cost against the best *advertised* quote is about 0.18%, the honest pool's genuinely worse price |
| **B5** Gas | Gas *limit* needed (what Monad charges), `eth_estimateGas` on the fork: protected swap **240k** (hookless pool) and **305k** (honest hook) vs **175k** and **195k** for the unprotected router, so **1.37x and 1.57x**. This was 5.4x and 5.0x before the gas guard was made failure-attributable (docs/GAS.md). With Monad's cold-access repricing added the honest protected swap is estimated at about 0.54M gas (about 0.62M limit); that is an estimate until it is measured on testnet. |
| **B7** Dashboard latency (tx confirmed to Fill queryable in Envio) | p50 **0.97 s**, p95 **1.08 s**, 0 timeouts over 10 swaps. Local fork, Envio in RPC mode with its default 1 s polling: this is dominated by Envio's poll interval and says nothing about HyperSync on the real network. |
| **Envio vs chain** after the whole run (174 fills, 141 strikes, 104 probes across the 7 hooks) | `pnpm check-indexer`: the index agrees with the Scoreboard for all 7 hooks (status, fills, strikes, probes, probe strikes) |

## What would change these numbers

* Testnet gas (Monad's repriced schedule) will change B5, and possibly the right gas caps. A hook that needs more gas
  than the leg cap is treated as failed.
* A real-world hook population may contain hooks that discriminate on the caller; the canary is an arms race, see
  THREAT_MODEL.md.
* The arena has not been run with a language model. With an LLM the protected arm should behave identically (the model
  only chooses tools); the unprotected arm could differ if the model decides not to trust the best quote. That has not
  been measured.
