# Spikes S1 to S4 (spec section 15)

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

* **Caveat, stated plainly.** revm uses Ethereum's gas schedule. Monad reprices some opcodes (notably cold storage
  and account access), and charges the gas **limit**, not gas used. These numbers are a lower bound. They must be
  re-measured with `eth_estimateGas` on the real testnet after deployment (record in DEPLOYMENTS.md).
* **Decision.** Default `quoteGasCap` and `legGasCap` set to **700,000** each (spec started at 1.5M): roughly 7x the
  worst local honest quote and 2-3x a full local leg, leaving room for Monad repricing and heavier hooks. Both are
  owner-tunable within [100k, 5M] (`setCaps`). A hook that needs more than the cap to settle is treated as an execution
  failure (documented in THREAT_MODEL.md). The router also refuses to start a quote or leg when `gasleft()` is below
  the cap plus a reserve (`InsufficientGas`), so a caller who supplies too little gas gets a revert, never a false strike.
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
