# Spikes S1 to S5 (spec section 15; S5 is the gas caps, added after benchmark B5)

Format: question, test, result, decision. Every result below is reproducible with the command shown.
Local toolchain: Foundry 1.7.1 (spec pins 1.8.0; no behaviour difference observed), solc 0.8.26, EVM cancun.

## S1. Can FirmRouter call the V4 Quoter inside a transaction, at acceptable gas?

**Test.** `contracts/test/Spikes.t.sol` (local PoolManager and the real `V4Quoter` from v4-periphery) and the whole
router suite re-run against a fork of Monad Testnet using the *deployed* PoolManager
`0x451D64ab3b650040d2aE1886602b97ed6eDc643d` and V4Quoter `0x869834d127b230283fe63E0d0A9bEB67216a94C7`
(`contracts/test/Fork.t.sol`).

```
forge test --match-contract SpikesTest -vv
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract ForkFirmRouterTest
```

**Result: PASS.**

* The Quoter works when called from a contract inside a transaction (it is revert-based but self-contained: it
  unlocks the PoolManager, swaps, reverts with the amount and the Quoter parses it).
* On an honest pool the in-transaction quote equals the real output **exactly** (difference 0 wei, criterion was 1 wei),
  with and without a hook, locally and on the testnet fork. 30/30 router tests pass against the real deployed contracts.
* Gas (local revm, Ethereum gas rules):

| Item | Gas |
|---|---|
| One in-tx quote, hookless pool | 69,183 |
| One in-tx quote, honest hook (afterSwap delta) | 95,528 |
| Whole `swapExactIn`, hookless, single leg (quote + leg + bookkeeping) | 253,035 |
| Whole `swapExactIn`, honest hook, single leg | 326,321 |
| Reject path (quote + failed leg + strike write), single route | 379,065 |
| Reject B, skip B (BLOCKED), fill C (3 routes touched) | 691,216 |

* **Caveat, stated plainly (fork-measured, not Monad-measured).** revm uses Ethereum's gas schedule. Monad reprices some opcodes (notably cold storage
  and account access), and charges the gas **limit**, not gas used. These numbers are a lower bound. They must be
  re-measured with `eth_estimateGas` on the real testnet after deployment (record in DEPLOYMENTS.md).
* **Decision (revised after benchmark B5, see docs/GAS.md).** The first decision was 700,000 for both caps plus an up-front
  `gasleft() >= cap*64/63 + reserve` check. B5 showed that forced a gas limit about 5x the raw swap's. Now: the check is only
  used to *attribute a failure* (a failed quote or leg without its full cap reverts with `InsufficientGas` instead of skipping or
  striking), caps are `quoteGasCap` 300,000 and `legGasCap` 450,000 (worst honest measurement with Monad's cold-access
  repricing added, x1.5), and `GAS_RESERVE` is 300,000 (the old 100,000 could not cover a Scoreboard strike write on Monad).
  Both caps are owner-tunable within bounds (`setCaps`; bounds and measurements in S5); a hook that needs more than the cap is
  treated as failed when the leg had its full gas. **All gas numbers here are fork-measured, not Monad-measured.**
* Fallback F1 (off-chain quote + freshness) **not needed.**

## S2. Can we mine a hook address with the needed permission bits, initialise a pool and swap through it?

**Test.** `test_S2_hookAddressWithFlagsInitialisesAndSwaps` places fixture hooks at addresses whose low 14 bits equal the
required flags (`deployCodeTo`) and swaps through them. `contracts/script/DeployFixtures.s.sol` does the same on
testnet with CREATE2 salt mining (`contracts/script/HookMiner.sol`, unit-tested in `test/HookMiner.t.sol`).

**Result: PASS.** `Hooks.validateHookPermissions` in each fixture constructor enforces that the address matches the
declared permissions exactly.

**Decision.** Use CREATE2 mining through the Foundry deterministic deployer `0x4e59b44847b379578588920ca78fbf26c0b4956c`
(spec 5.2). Note on a deviation: the spec points at the example repo's `NamespacedHookMiner`; we ship our own small
`HookMiner` (same idea, no extra dependency) because the example repo pins its own dependency tree.

## S3. Do try/catch with a gas cap and a self-call isolate a failing leg while strikes persist, with capped return data?

**Test.** `FirmRouter.t.sol`: `test_gasGriefHookIsIsolated`, `test_revertHookIsIsolated`,
`test_returnDataBombCannotBreakTheRouter` (500,000-byte revert payload), `test_reentrancyAttemptIsContainedAndStruck`,
`test_allLegsFail_refundsInputAndStrikesPersist`.

**Result: PASS.** A gas-burning, reverting, return-data-bombing or re-entering hook leaves the user's funds intact, the
strike is written in the outer frame and survives (even when every leg fails and the call returns normally with
`NoFill`), and the next route fills. At most 68 bytes of return data are ever copied. Fallback F3 (separate
LegExecutor) **not needed.**

## S4. Exact `Initialize` event signature and hook flag bit positions

**Test.** `test_S4_initializeEventSignature`, `test_S4_hookFlagBitLayout`, plus reading `Hooks.sol` and
`IPoolManager.sol` in the pinned v4-core checkout.

**Result: PASS.**

```
Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1,
           uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)
topic0 = keccak256("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")
```

(`PoolId` is `bytes32` and `Currency`/`IHooks` are `address` in the ABI signature.)

Flag bits from `Hooks.sol`: `BEFORE_SWAP = 1<<7`, `AFTER_SWAP = 1<<6`, `BEFORE_SWAP_RETURNS_DELTA = 1<<3`,
`AFTER_SWAP_RETURNS_DELTA = 1<<2`, `BEFORE_ADD_LIQUIDITY = 1<<11`, `BEFORE_REMOVE_LIQUIDITY = 1<<9`.
Counter's `0x0ac0` = `0x800 + 0x200 + 0x80 + 0x40` matches. The tutorial value `BEFORE_SWAP = 1<<0` is wrong for
this core, as the spec warned.

## S5. Are the gas caps (quote 300k, leg 450k, reserve 300k) right, and what happens to an honest hook that is expensive?

> **All gas numbers in this section are FORK-MEASURED, NOT MONAD-MEASURED** until they are re-run on the real testnet.
> "eth gas" is the gas used on a local anvil fork of Monad Testnet (Ethereum's gas schedule). "Monad est." adds Monad's
> cold-access repricing as an *estimate* (+6,000 per distinct cold storage slot, +7,500 per cold account, from
> docs.monad.xyz opcode pricing, counted with the prestate tracer). It is not a measurement. Two runs of the same tool on
> two fresh fork deployments disagreed by up to 35% (quote C: 130k then 96k eth gas), so both are shown and the larger is used.

**Test.** `pnpm gas-profile` (`backend/bench/src/gasProfile.ts`) against a fork deployment made by `Redeploy.sh`, and
`contracts/test/GasCaps.t.sol` (run: `forge test --match-contract GasCapsTest -vv`).

### Measured worst honest case, and margin to the cap

What the cap applies to: `quoteGasCap` limits one in-transaction V4 Quoter call (it executes the pool's swap and the hook).
`legGasCap` limits one `executeLeg` self-call: `poolManager.unlock` + swap + hook callbacks + the token transfers in and out.
`pnpm gas-profile` measures the leg through `RawRouter.swapExactInRaw`, which also includes two user-side token transfers,
so it slightly *over*states the capped leg (the conservative direction).

| Path | Worst honest, eth gas (fork) | Worst honest, Monad est. | Cap | Margin to cap (Monad est.) | Margin (eth gas) |
|---|---|---|---|---|---|
| **Quote** | 130,301 (pool C, run 1); 96,390 (run 2) | **188,801** (run 1); 154,890 (run 2) | 300,000 | **1.59x** (run 1); 1.94x (run 2) | 2.3x |
| **Leg**, honest fixtures (hookless A, honest C, quote-only Q) | 157,467 (A, run 2) | 262,451 (C, run 2) | 450,000 | **1.71x** | 2.9x |
| **Leg**, heaviest non-reverting fixture (D: storage write on the real path; E in run 1) | 214,104 (D, run 2); 184,672 (E, run 1) | **334,104** (D, run 2); 292,672 (E, run 1) | 450,000 | **1.35x** (run 2); 1.54x (run 1) | 2.1x |
| Post-leg work (Scoreboard strike or fill write + 60k) | 128k | 164,333 | reserve 300,000 | 1.8x | |

Full table of run 2 (Monad est. column):

```
what                                           eth gas  slots  accts  Monad est.
quote  pool A (hookless)                         92860      5      1      130360
quote  pool B (context hook)                     76162      4      2      115162
quote  pool C (honest hook)                      96390      6      3      154890
quote  pool D (random-fee hook)                  99945      5      2      144945
quote  pool E (sender-aware hook)                99963      5      2      144963
quote  pool G (gas-grief hook, quote path)       99191      5      2      144191
quote  pool Q (quote-only hook)                  79527      5      2      124527
leg    pool A (incl. token transfers)           157467     13      3      257967
leg    pool B                                   154584     13      4      262584
leg    pool C                                   154451     13      4      262451
leg    pool D                                   214104     15      4      334104
leg    pool E                                   191573     14      4      305573
leg    pool Q                                   146800     13      4      254800
Scoreboard.recordStrike                          68333      6      0      104333
Scoreboard.recordFill                            41768      6      0       77768
FirmRouter.swapExactIn [C] (whole)              262223     21      6      433223
```

**Reading it honestly.** The 1.5x margin policy (`GAS.md`) is met for the honest fixtures and for the quote, but **not for the
heaviest fixture's leg**: pool D gives 1.35x against the current 450k cap. The profile tool's own recommendation from that
run at 1.5x is quote 250k / leg 525k / reserve 250k. The defaults were not changed in this step (changing them would
invalidate the committed fork benchmark numbers, which were produced with 450k), so **retuning is an open decision**: see below.

### Behaviour tests (`GasCaps.t.sol`, local EVM, Ethereum schedule)

| Question | Result |
|---|---|
| Honest hook that uses **2x the typical hook gas** (+80k per path on a hook whose own cost is about 25k to 40k) | **filled, not skipped, not struck**: `test_honestHookUsing2xTheTypicalHookGasIsNotBlocked` (quote 146k, leg 242k) |
| How much extra gas may an honest hook burn before a cap stops it? | **220k per path = 5.5x the typical hook gas**; the **quote cap binds first** (a silent skip, no strike): `test_howMuchExtraGasAnHonestHookMayBurnBeforeACapStopsIt` |
| Gas-grief fixture: is the out-of-gas recorded correctly? | **yes**: `StatusChanged(UNRATED -> BLOCKED, "SEVERE_SHORTFALL")`, `StrikeRecorded(.., settled 0, shortfall 10000, execFailed true)`, `Rejected(.., execFailed true)`, exactly one strike, `lastStrikeAt` set; the whole swap used 632k, i.e. the leg really burned its 450k cap and the router still finished inside quote cap + leg cap + reserve; the next swap skips the hook (`LegSkipped` reason 0) instead of striking twice: `test_gasGriefOutOfGasIsRecordedCorrectly` |
| Starvation (caller's own gas limit too low) never blames a hook | `FirmRouter.t.sol`: `test_noGasLimitEverStrikesOrSkipsAnHonestHook`, `test_hostileLegIsOnlyStruckWithFullGas`, `test_insufficientGasRevertsInsteadOfFalseStrike` |

**Caveat on the 5.5x.** It is measured on the Ethereum schedule. On Monad the base quote is higher (155k to 189k estimated,
against about 100k here), which leaves roughly 110k to 145k of room for the hook's own extra gas, i.e. about 3x to 3.6x the
typical hook, not 5.5x. Expect honest hooks that are much heavier than our fixtures to be **skipped** on Monad.

### Where a cap that is too tight wrongly hits an honest hook (flagged, each pinned by a test unless noted)

| # | Where | What happens | Visible? | Test |
|---|---|---|---|---|
| 1 | `FirmRouter._tryLeg`, `legGasCap` | a leg that runs out of gas while it had its full cap is `execFailed`, a **100% shortfall**, which is `SEVERE` and **BLOCKS the hook on the first occurrence**, even if it is honest and merely heavy | yes: a public false strike | `test_FLAG_honestHookOverTheLegCapIsStruckAndBlocked_thenFixedBySetCaps` |
| 2 | `FirmRouter._attempt`, `quoteGasCap` | a quote that fails inside the cap skips the route (`LegSkipped` reason 2); no strike | **no**: the hook silently gets no flow and the Scoreboard shows nothing | `test_FLAG_honestHookOverTheQuoteCapIsSkippedNotStruck` |
| 3 | `CanaryRunner.probe` (`ProbeSender.run`), its own `legGasCap` | a probe leg that runs out of gas settles 0, which `recordProbe` counts as a full shortfall: **a strike through the canary** | yes | `test_FLAG_canaryProbeStrikesAnHonestHeavyHookWhenItsLegCapIsTight` |
| 4 | the leg includes the **token transfers** (`_settle`/`take`) | a token with an expensive `transfer` (fee-on-transfer, proxy, hooks) makes the leg heavy; the hook is blamed | yes (as #1) | **not tested**; same mechanism as #1 |
| 5 | the quote and the leg include the **pool's own tick-crossing cost** | a large trade through thin or fragmented liquidity crosses many ticks and can exceed the quote cap (skip) or the leg cap (strike) with a perfectly honest hook | as #2 / #1 | **not tested**; stated as a risk |
| 6 | CanaryRunner caps are separate from the router's | they can drift apart, so a hook can pass the router and fail a probe or the reverse | yes | `test_canaryCapsAreOwnerConfigurableWithinBounds` (configurable; keep them in step) |

### Caps are now owner-configurable, within bounds, without a redeploy

`contracts/src/libraries/GasBounds.sol`, used by `FirmRouter` and `CanaryRunner`:

| Parameter | Default | Bounds | Setter | Why this floor |
|---|---|---|---|---|
| `legGasCap` | 450,000 | **350,000 to 1,500,000** | `setCaps(leg, quote, advTolBps)` | 350k is just above the worst non-reverting leg measured (334k Monad est.) |
| `quoteGasCap` | 300,000 | **200,000 to 1,000,000** | same | 200k is just above the worst quote measured (189k Monad est.) |
| `gasReserve` (was a constant) | 300,000 | **150,000 to 1,000,000** | `setGasReserve(n)` | a strike write alone is about 104k eth gas / 139k Monad est. |

The floors exist so that a typo cannot start false-striking honest hooks (flag #1); the ceilings keep `MAX_LEGS = 4` hostile
legs inside one transaction. `test_boundsMinimumsCoverTheMeasuredWorstHonestCase` pins the floors above the numbers in this
section. The previous bounds were [100k, 5M] with a constant reserve. One consequence: the owner cannot lower the leg cap
below 350k even if real Monad measurements turn out lower; that needs a redeploy.

### Update, 2026-10-11: first Monad-measured numbers (public testnet, `eth_estimateGas`, 100 tUSD)

The numbers above are fork-measured plus an estimate. After the real deployment the same quantities were measured on Monad:

| Quantity | Monad-measured | Compare | Margin to cap |
|---|---|---|---|
| One Quoter call (includes the 21k base cost, so it overstates the call) | worst **141,022** (pool C), others 98k to 117k | estimate was 189k | `quoteGasCap` 300,000: **at least 2.1x** |
| Whole raw swap (leg + 2 token transfers + base cost), so an upper bound of the leg | worst **347,884** (pool D), A 276,219, C 318,983 | estimate for the leg was 334k (D) | `legGasCap` 450,000: **at least 1.29x**, larger for the leg alone |

So the estimate was close for the leg and pessimistic for the quote. The leg margin is still only bounded from below (a trace
would isolate the leg), so the 1.5x policy question for the heaviest storage-writing hooks is **not settled**, only less worrying.
The caps were not changed. Receipts on Monad show gas used equal to the gas limit, so these figures come from `eth_estimateGas`.
A fork-derived 300,000 limit for the raw demo swap ran out of gas on the real chain (it needs about 319k); that is the same
Monad-versus-fork gap, 1.5x to 1.6x.

### Open decision, and how to retune on testnet

1. After deployment, run `pnpm gas-profile` and B5 against the real testnet (needs `debug_traceCall`; otherwise compare
   `eth_estimateGas` for each pool) and replace the "Monad est." column with measurements.
2. If heavy honest hooks matter, raise the leg cap: `cast send <FirmRouter> "setCaps(uint256,uint256,uint16)" 525000 300000 50`
   (and the same on CanaryRunner). Cost of a higher leg cap: a hostile leg may burn more, once per hostile hook (it is then
   BLOCKED and skipped); honest swaps pay nothing extra because no gas is demanded up front.
3. A wrongly struck hook is undone by the owner with `Scoreboard.reinstate(hook)` (BLOCKED -> WATCH, then it recovers by fills).

## Findings that changed the design (not in the spec)

1. **Sender-aware fixture must be honest to the Quoter too.** The spec table says `FixtureSenderAwareHook` is "honest
   toward the FirmRouter address, takes a fee for every other caller". Read literally, the Quoter would also be a
   "other caller", so the quote would already include the fee and a canary probe would compare two equally-taxed
   numbers and see no shortfall. Spec 4.2 describes the intended case: honest to both the Quoter and FirmRouter, cheats
   other callers. The fixture implements 4.2. `test_senderAwareHookLooksCleanThroughFirmRouterButIsCaughtByCanary`
   demonstrates the intended behaviour.
2. **UNRATED cap vs the demo.** The default `UNRATED_CAP` of 100 tokens would skip every 1,000-token demo leg (all
   fixture hooks start UNRATED). The deploy script raises the cap to 10,000 tokens (inside the bounded range) so the
   headline demo runs; the change is an owner `setParams` transaction recorded in DEPLOYMENTS.md.
3. **Pool seeding helper.** Instead of PositionManager + Permit2 plumbing, `FixtureLiquidityHelper` adds liquidity
   straight through the PoolManager. It behaves identically locally, on a fork and on testnet, and keeps seeding
   scripts short. (Quarantined with the other fixtures.)
4. **Liquidity depth.** Pools are seeded with L = 1e27 over the full tick range so that a 1,000-token trade has
   negligible price impact and the quote order B, C, A is driven only by the configured fees.
