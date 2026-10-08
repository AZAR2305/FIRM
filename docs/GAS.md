# Gas: why a protected swap used to need ~5x the gas limit, and what changed

> **Every gas number in this file is fork-measured (Ethereum gas schedule) or an estimate that adds Monad's published cold-access
> repricing. None of it is Monad-measured yet.** Re-run `pnpm gas-profile` and B5 on the real testnet and replace it.
> The per-cap margins, the honest-hook tests and the places where a tight cap wrongly hits an honest hook are in `SPIKES.md` S5.

Monad charges the **gas limit** you set, not the gas you use ("the gas charged for a transaction is the gas limit set in the
transaction, rather than the gas used in the course of execution", docs.monad.xyz, gas pricing). So the *limit a swap needs* is
the cost that matters, and a router that forces a large limit makes every swap expensive even when it uses little.

## The problem (found in benchmark B5)

`FirmRouter` runs each quote and each leg in a gas-capped sub-call so that one hostile hook cannot burn the caller's whole
budget. The first version also demanded, **before** every quote and leg, that `gasleft() >= cap * 64/63 + reserve`. The reason
is sound: if a sub-call is starved of gas and fails, that says nothing about the hook, and striking it would blame an honest hook
for the caller's low gas limit. But checking it up front made the smallest valid limit about `cap + reserve` (about 0.9M with the
700k caps) even though an honest swap uses about 0.2M to 0.35M:

| (fork, Ethereum gas schedule) | raw swap | protected swap, before | protected swap, now |
|---|---|---|---|
| hookless pool, gas limit needed (`eth_estimateGas`) | 175k | 938k (5.4x) | **240k (1.4x)** |
| honest-hook pool, gas limit needed | 195k | 967k (5.0x) | **305k (1.6x)** |

## The fix: attribute a failure, do not pre-pay for it

Gas starvation only matters when a sub-call **fails**. So `FirmRouter._attempt` now:

* runs the quote and the leg with their caps but **no up-front gas requirement**; a call that succeeds with less than its cap is fine;
* remembers whether the call *did* have its full cap plus reserve (`gasleft() >= cap*64/63 + gasReserve` at call time);
* if a quote **fails** without full gas, or a leg **fails** (execution failure, out of gas) without full gas, it **reverts with
  `InsufficientGas`** instead of skipping the leg or striking the hook;
* a measured `Shortfall` (the swap completed and delivered less than the floor) is a valid strike regardless of gas.

Why revert rather than skip? `eth_estimateGas` binary-searches the smallest limit that does not revert. If starvation produced a
silent skip or `NoFill`, the estimate would come out far too low and users would pay for swaps that quietly do nothing. A revert
keeps estimation honest, and a wallet that sets the limit from `eth_estimateGas` gets a working number.

Properties, each pinned by a Foundry test (`contracts/test/FirmRouter.t.sol`, also run on a fork of testnet with the real
PoolManager and Quoter):

* `test_honestSwapNeedsAGasLimitNearItsRealUse`: an honest protected swap succeeds from a 380k limit on the local EVM.
* `test_noGasLimitEverStrikesOrSkipsAnHonestHook`: sweeping the gas limit from 100k to 1M, an honest first route is never
  struck and never skipped for lack of gas; the call either fills it or reverts.
* `test_hostileLegIsOnlyStruckWithFullGas`: with a gas-griefing hook first, low limits revert and leave no strike; enough gas
  strikes it and falls back to the next route. The hook can still make a *too-small* transaction revert, but it cannot make a
  correctly sized one fail, and it cannot get an honest hook blamed.

## The caps, from measurement

A fork runs Ethereum's gas schedule; Monad reprices cold accesses (docs.monad.xyz, opcode pricing: cold SLOAD 2,100 -> 8,100,
cold account access 2,600 -> 10,100, SSTORE gains page-load and page-write components). `pnpm gas-profile` (in `backend/`)
traces a quote, a leg and the Scoreboard writes with `debug_traceCall`, counts the distinct cold slots and accounts each touches
(prestate tracer), and adds `6,000` per cold slot and `7,500` per cold account. This is an **estimate**, not a Monad
measurement. Output of one run on a fork of testnet:

```
what                                           eth gas  slots  accts  Monad est.
quote  pool A (hookless)                         85891      4      1      117391
quote  pool C (honest hook, worst)              130301      6      3      188801
leg    pool A (incl. token transfers)           151925     12      3      246425
leg    pool E (worst)                           184672     13      4      292672
Scoreboard.recordStrike                         102671      6      0      138671
Scoreboard.recordFill                            78906      6      0      114906
FirmRouter.swapExactIn [C] (whole)              367249     21      6      538249

worst honest quote 188,801   worst honest leg 292,672   post-leg work 198,671 (strike write + 60k for events/refund)
x1.5 margin, rounded up to 25k:  quoteGasCap 300,000   legGasCap 450,000   gasReserve 300,000
```

| Parameter | Was | Now | Basis |
|---|---|---|---|
| `quoteGasCap` | 700,000 | **300,000** | worst honest quote 189k (Monad-adjusted) x 1.5 |
| `legGasCap` | 700,000 | **450,000** | worst honest leg 293k (includes token transfers the router does outside the leg) x 1.5 |
| `gasReserve` | 100,000 | **300,000** | a strike write alone is about 139k Monad-adjusted; the old value was **too small for Monad** and would have let a hostile leg that burns its cap leave the router unable to finish |

`quoteGasCap`, `legGasCap` and the reserve are owner-tunable without a redeploy, within `GasBounds` (leg [350k, 1.5M], quote [200k, 1M],
reserve [150k, 1M]; `setCaps`, `setGasReserve`; see `SPIKES.md` S5). `CanaryRunner` uses the same defaults and keeps its stricter up-front check, because a probe that records a false
strike would corrupt the ledger and the canary is not user-facing.

### What the limits look like now (Monad-adjusted estimates)

* Honest protected swap (best route fills): about **0.54M** gas on Monad, so a limit of roughly **0.62M** with a 15% buffer. The
  matching unprotected swap is about 0.3M.
* A hostile first route: the leg can burn its full 450k cap, so a *correctly sized* limit is about 1.0M to 1.3M. Only swaps that
  actually meet a hostile hook (an UNRATED one that has not been struck yet) pay this, once: the hook is then BLOCKED and skipped.
* `MAX_LEGS = 4` bounds the worst case.

## Still to do (needs the real network)

* Run `pnpm gas-profile` and the benchmark (B5) against the real testnet deployment, if the RPC supports `debug_traceCall`, and
  compare with `eth_estimateGas` there. Replace the estimate, then tighten or loosen the caps with `setCaps`.
* Watch for honest hooks that exceed the leg cap on Monad: such a hook is treated as failed (a strike, when the leg had full gas).
  The 1.5x margin is a judgement, not a guarantee.
