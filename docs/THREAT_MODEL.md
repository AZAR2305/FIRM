# FIRM threat model

Scope: the onchain contracts (`Scoreboard`, `FirmRouter`, `CanaryRunner`, `ProbeSender`, `SwapExecutor`) and the offchain services around them, on Monad Testnet. The comparator `RawRouter` is deliberately unprotected and out of scope. Written to be read adversarially: limits are listed, not hidden.

## 1. Assets and what must hold

| Asset | Property we want |
|---|---|
| User input tokens during a swap | After `swapExactIn` returns, the user either received exactly `settledOut` for exactly `used` input (the rest refunded), or got the full input back. The router holds zero balance afterwards. |
| The fill the user accepts | The leg that fills delivered at least `quote - tolerance(status)` where `quote` was obtained from the V4 Quoter in the same transaction, and at least the user's own `minTotalOut`. |
| The Scoreboard record | Strikes never decrease. A hook leaves `BLOCKED` only through the owner's `reinstate`. A strike persists even when the swap call returns normally. |
| Availability | One hostile hook cannot make `FirmRouter.swapExactIn` revert as a whole, burn the caller's whole gas budget, or corrupt other legs. |

Tested properties (Foundry): router balance zero after every call (fuzz over amount and route order); the context-spoofing hook never fills; strikes monotone; BLOCKED sticky; every Scoreboard transition including window edges; gas-grief, reverting, 500 KB return-data-bomb and re-entering hooks contained; low gas reverts instead of striking falsely.

## 2. Actors and trust

| Actor | Trusted for | Not trusted for |
|---|---|---|
| `FirmRouter`, `Scoreboard`, `CanaryRunner` | every fund-affecting and status-affecting decision | nothing offchain takes part in these |
| Owner (Ownable2Step) | reporter allow-list, bounded parameters, gas caps, `reinstate`, rescuing tokens sent by mistake | **cannot move user funds**: no function takes user tokens; `rescueToken` is `nonReentrant` so it cannot touch tokens mid-swap |
| Reporters (`FirmRouter`, `CanaryRunner`) | writing fills, strikes and probes | they are contracts; an owner who adds an EOA or malicious contract as reporter could write arbitrary records (see 4.1) |
| canary-agent | triggering probes, writing reports | it cannot set status; evidence is computed onchain by `CanaryRunner`. It holds a testnet key with dust only |
| LLM (optional) | prose reports | never decides execution, status or parameters; its text is sanitised and only displayed |
| quote-api | ordering candidate routes | `FirmRouter` re-quotes and re-checks everything onchain; a lying quote-api can only cost the user fallbacks, not funds |
| Indexer | display | contracts never read it |
| Hook authors | nothing | adversarial by assumption |
| Other callers of the Scoreboard | n/a | read-only; status is a signal, not a guarantee |

## 3. How the core check works, and what it cannot see

The V4 Quoter calls the PoolManager as the swap caller, so a hook sees the **Quoter's address** as `sender` on the quote path and **FirmRouter's address** on the real path, both inside one transaction, from one state. Any difference between the two outputs is therefore caused by the hook's behaviour, not by the market.

Consequences, with tests:

- A hook that spoofs for quote requests (the pattern 0x describes: price one way in a quote, another at settlement) is caught: `FixtureContextHook` is rejected, struck, blocked, and the swap falls back (`test_contextHookRejectedAndFallsBackToHonestPool`).
- FirmRouter must **not** be replaced by a self-simulation through itself: the hook would see the same sender on both paths and Quoter-specific spoofing would go unseen. (Rule in CLAUDE.md.)
- **Not caught by the in-transaction check:** a hook honest toward both the Quoter and FirmRouter that cheats other callers (`FixtureSenderAwareHook`). Covered, probabilistically, by CanaryRunner probes from other sender identities (`test_senderAwareHookLooksCleanThroughFirmRouterButIsCaughtByCanary`, benchmark B4).
- **Not caught:** a hook that is expensive but consistent. FIRM measures promise-keeping, not price quality.
- A hook that quotes high to an off-chain `eth_call` (zero gas price) and honestly in a real transaction produces equal in-transaction quote and fill, so no strike can fire. The optional `advertisedOut` (the off-chain quote) catches this: if the in-transaction quote is below it by more than `advTolBps` the leg is **skipped** (reason 4), never struck, because market movement is a legitimate explanation (`test_advertisedMismatchSkipsQuoteOnlyHook`).

## 4. Attacks, mitigations and residual risk

### 4.1 Against users

| Attack | Mitigation | Residual |
|---|---|---|
| Hook takes a hidden fee at execution | in-transaction quote vs fill; leg reverted atomically; strike; fallback | none for the spoof-the-Quoter family |
| Hook burns gas / reverts / returns a huge revert payload to DoS the router | per-leg gas cap in a self-call; at most 68 bytes of return data are copied; failure after a good quote is a 100% shortfall (severe, blocked) | the caller still pays for gas consumed up to the cap, and **Monad charges the gas limit**, so a chain of hostile legs costs up to `legGasCap` each |
| Hook re-enters the router | `nonReentrant`; `executeLeg` is self-only; `unlockCallback` is PoolManager-only | none known |
| Caller supplies too little gas so a leg fails and an honest hook is struck | A failed quote or leg is only blamed on the hook when it had its full cap plus a reserve (`gasleft() >= cap*64/63 + gasReserve` at call time); otherwise the whole call reverts with `InsufficientGas`. A completed swap that delivers less than its floor is still a valid strike at any gas. Tested by sweeping gas limits (`test_noGasLimitEverStrikesOrSkipsAnHonestHook`) | a hook that genuinely needs more than the cap is treated as failed (false positive); the cap is a margin on a fork-measured, Monad-adjusted estimate (1.35x on the heaviest fixture leg), not a guarantee, and a tight cap blocks an honest hook on the first occurrence (5.4). Owner can retune it within `GasBounds` (leg 350k to 1.5M, quote 200k to 1M) |
| Malicious token (fee on transfer, hooks on transfer, rebasing) | non-goal: ERC-20 only, fee-on-transfer unsupported | a pool with such a token can make a swap revert (not lose funds: the call reverts) |
| Quote-api (or UI) lies | router ignores it except `advertisedOut`, which can only make it skip a leg | worse routing, not loss |
| Sandwich / MEV | out of scope | users still need their own `minTotalOut` |
| User approves the router and the router is later compromised | the router has no owner power over user funds and holds nothing between calls | users should approve exact amounts, not `max` |

### 4.2 Against the Scoreboard (reputation attacks)

| Attack | Mitigation | Residual |
|---|---|---|
| **Framing**: make an honest hook look dishonest | A strike needs `settled < floor` where both numbers come from the same transaction and the same state, so a third party cannot create one. `hookData` is passed to both the quote and the swap. | token behaviour (see above); an honest hook with legitimate caller-specific discounts looks different to different senders and may land in WATCH |
| **Laundering**: get a malicious hook rated NORMAL | `UNRATED -> NORMAL` needs 6 clean probes from at least 3 distinct sender contracts, or 100 clean fills. A strike resets the streak. WATCH needs 200 clean fills and 24 h. `UNRATED_CAP` limits exposure of unrated hooks (default 100 tokens; the demo raises it to 10,000). | a hook that recognises probes and the router and is honest only to them is rated NORMAL (below) |
| **Probe fingerprinting**: hook detects `ProbeSender` (deterministic CREATE2 addresses, bytecode) and is honest only to it | multiple sender identities, re-probing every few hours (`CANARY_REPROBE_HOURS`), and real user fills also feed the record | **an arms race, not solved.** The arXiv paper documents propAMMs penalising callers by address and bytecode fingerprint. A hook that discriminates by caller can still behave honestly to FIRM and cheat everyone else |
| **Hook changes behaviour after rating** (upgradeable hook, owner-controlled switch) | re-probe rounds; any strike moves a NORMAL hook to WATCH, and a severe one straight to BLOCKED | window between a behaviour change and the next probe or fill. Status is per hook **address**, not per pool |
| **Probe spam** | probes are permissionless (anyone can run the dust check, which is the point), but each costs the caller gas and dust and `recordProbe` is O(1) | any address can add probes, honest or not. A hook author can therefore run clean probes against their own hook from several `ProbeSender` identities to reach NORMAL (6 clean probes from 3 distinct senders), then cheat. That is the laundering row above: the rating is evidence, not a guarantee, and one later strike downgrades the hook |
| Pool-creation spam with exotic hooks | `UNRATED_CAP`, `MAX_LEGS = 4`, the canary only probes pools it discovers | canary cost scales with pool count; a rate limit is not implemented |

### 4.3 Admin and operational

| Risk | Note |
|---|---|
| **Owner key compromise** | Cannot move user funds. Can add a malicious reporter that writes false statuses (blocking competitors, rating a bad hook NORMAL), change parameters within bounds, reinstate hooks, and mis-set gas caps within bounds (5.4). This is the central centralisation trade-off of the hackathon design (5.3). Roadmap: staked attesters and a timelock; two-step ownership transfer is already used. |
| Parameter bounds | `setParams` range-checks every field (tolerances at most 100 bps, severe 50 to 5000 bps, window 1 min to 7 days, cap 1 to 1,000,000 tokens, ...). Gas caps and the reserve are bounded by `GasBounds` (leg [350k, 1.5M], quote [200k, 1M], reserve [150k, 1M]). |
| Immutable Quoter address | If the Quoter were redeployed, FirmRouter must be redeployed (`Redeploy.sh`). |
| Testnet reset | Everything is redeployable from scratch; addresses live in `deployments/10143.json`. |
| Private keys | none in git; `.env` is ignored; deploy scripts use a Foundry keystore account or a testnet-only key; the canary and bench keys are separate testnet wallets. |
| Fixtures | Misbehaving hooks exist only in `contracts/test-fixtures`, are deployed to testnet only, are not registered in any hook list, and the repository says so. They must never be deployed to mainnet. |
| LLM output | treated as untrusted text: tags and control characters stripped, length capped, never parsed for decisions. |

### 4.4 Agents, the MCP tool server and the indexer

| Risk | Mitigation | Residual |
|---|---|---|
| **A confused, buggy or prompt-injected agent** spends or swaps badly | The only swap tool a protected agent has is `firm_swap`, which goes through `FirmRouter`: every leg is quote-checked onchain, a cheating leg is reverted. The agent cannot pass a minimum lower than the router enforces per leg, and cannot skip the check. | An agent can still choose a bad trade size, token or `minOut`, and a hook that behaves honestly toward FirmRouter and cheats others is not caught by the router (sender-aware limit, above). |
| **raw_swap** (the unprotected comparator) reaching a real agent | Registered only when `FIRM_MCP_ENABLE_RAW=1`; the arena gives each arm only its own tools (`restrict`), and the tool output is labelled UNPROTECTED. | Whoever runs the server can turn it on. Never enable it with a wallet that holds real value. |
| **Agent key theft** | `TRADER_PRIVATE_KEY` / `CANARY_PRIVATE_KEY` are testnet-only wallets holding test tokens and dust MON, read from the environment, never logged, never committed (`.env` is ignored). The MCP server logs to stderr only, because stdout is the protocol channel. | Anyone with the key can spend that wallet. Use separate keys per role and per environment. |
| **Model output used as data** | Numbers in the arena and benchmark come from tool results (transaction receipts and events), never from model text. The canary's optional LLM summary is stripped of tags and control characters, length-capped, shown only, never parsed. | A model can still write misleading prose in a report. It is labelled "AI-written, advisory" and sits under the deterministic report. |
| **Tool-argument abuse** (bad addresses, huge or negative amounts) | zod schemas on the server; amounts must be positive decimals; addresses are validated; `quote-api` re-validates and bounds `amountIn` below 2^128; errors come back as model-readable text, not stack traces. | Input validation is not authorisation: any caller of the stdio server can use the configured wallet. |
| **quote-api / indexer lying or lagging** | Neither is read by contracts. quote-api output only orders routes; the router re-quotes and re-checks. The Envio index is display and discovery only; `pnpm check-indexer` compares it with the Scoreboard hook by hook. | A stale or poisoned index can hide a pool from routing or show a wrong status on a dashboard, not move funds. A handler bug is possible: one was found and fixed during testing (probe strikes were not counted) precisely by that check. |
| **Local Envio stack** | Binds to localhost; the Hasura admin secret `testing` is the Envio dev default. | Never expose the local stack, and never reuse its admin secret anywhere real. |

## 5. The four limits that matter most

These are the places where FIRM is weakest. They are also listed in the README. Each one is a property of the design, not a bug waiting for a fix.

### 5.1 Sender-aware hooks are invisible to the in-transaction check

FirmRouter compares what the hook does for the **V4 Quoter** with what it does for **FirmRouter**. A hook that is honest toward both and
cheats everyone else produces equal numbers, so the router never strikes it. Our fixture `FixtureSenderAwareHook` does exactly this:
in the benchmark FirmRouter caught it **0 times in 20 swaps**, and only a canary probe from another sender identity caught it
(B1/B4, [RESULTS.md](RESULTS.md); `test_senderAwareHookLooksCleanThroughFirmRouterButIsCaughtByCanary`). The consequence for a user:
**a hook that has been cleared by FIRM may still cheat callers FIRM does not look like.** FIRM's evidence is "this hook kept its
promise to FIRM and to the canary", which is not "this hook keeps its promise to everyone". The canary narrows the gap; it does not close it
(5.2). The same applies to any hook that is honest only when `tx.origin` or the caller is a known address, or only at certain times.

### 5.2 Probe recognition is an arms race

CanaryRunner probes from deterministic CREATE2 `ProbeSender` contracts. Their addresses and bytecode are public and can be fingerprinted;
the arXiv paper on Monad propAMMs documents venues that penalise callers by address and bytecode fingerprint. A hook that recognises
`ProbeSender` (or anyone running probes, since probes are permissionless) can be honest to it and still cheat real users, and then earns
a NORMAL rating from 6 clean probes from 3 distinct sender contracts. What we do about it, and what that does not do:

| Defence | Limit |
|---|---|
| several sender identities (`senderIdx` rotates `ProbeSender` addresses) | still contracts we deploy; all of them are enumerable from `CanaryRunner` |
| re-probing on a schedule (`CANARY_REPROBE_HOURS`), different amounts and directions | a hook can detect dust-sized trades |
| real user fills also write to the Scoreboard through FirmRouter | users who reach a recognising hook through FirmRouter look like FirmRouter, not like other callers |
| any strike downgrades a NORMAL hook to WATCH and a severe one to BLOCKED | only after the hook misbehaves toward something we measure |

We do not claim this is solved. A bounded-cost improvement would be probes from fresh, non-deployed-by-us identities (for example funded
EOAs and ordinary contracts), which is not built.

### 5.3 The owner and the reporters are trusted roles

The hackathon design centralises two things on purpose:

* **Reporters** (`FirmRouter`, `CanaryRunner`) are the only addresses that can write fills, strikes and probes to the Scoreboard. They are
  contracts, but whoever owns the Scoreboard decides who is a reporter.
* **The owner** (`Ownable2Step`, the deployer by default) can add or remove reporters, change `Params` within bounds, set gas caps and the
  reserve within `GasBounds`, set the advertised-quote tolerance, **`reinstate` a BLOCKED hook** and rescue tokens sent to FirmRouter by
  mistake. It **cannot move user funds**: no function takes user tokens, and `rescueToken` is `nonReentrant`.

What a compromised or malicious owner **can** do: add an EOA as a reporter and write any record, so it can **block a competitor's hook**,
**rate a bad hook NORMAL** or reinstate a struck one; mis-set caps within bounds (see 5.4). Anyone relying on a status must trust the owner.
Nothing here is decentralised: there is no timelock, no multisig and no staked attester set. Mitigations in place: two-step ownership
transfer, bounded parameters, every change emits an event (`ReporterSet`, `ParamsSet`, `CapsSet`, `GasReserveSet`, `Reinstated`).
On a public deployment the deployer key is a single externally owned account on a testnet.

### 5.4 The gas caps trade false positives against griefing cost

Every quote and every leg runs under a gas cap (`quoteGasCap` 300k, `legGasCap` 450k, `gasReserve` 300k) so that one hostile hook cannot
burn the caller's budget. Monad charges the **gas limit**, so the cap also bounds what a hostile first route costs the caller: about 1.0M
to 1.3M for the whole swap, once per hostile hook (estimated, not Monad-measured).

* **Too tight is not safe.** A leg that runs out of gas while it had its full cap is recorded as `execFailed`: a 100% shortfall, which is
  `SEVERE` and **BLOCKS the hook on the first occurrence**, even if the hook is honest and merely heavy. A quote that exceeds its cap
  skips the route silently, so a heavy honest hook can be starved of flow with no trace on the Scoreboard. The same holds for probes: a
  probe whose leg runs out of gas settles 0 and is a strike. Expensive token transfers and large trades through fragmented liquidity use
  gas that is not the hook's fault and are attributed to it anyway. Each case is tested (`contracts/test/GasCaps.t.sol`, `FLAG` tests) and listed in
  [docs/SPIKES.md](SPIKES.md) S5.
* **Too loose is expensive.** A higher cap lets a hostile hook burn more of the caller's gas, once per hostile hook, and Monad bills the limit.
* **Where we stand.** Fork-measured plus estimate: the leg cap is 1.35x the heaviest non-reverting fixture leg and 1.71x the honest
  fixtures, below our own 1.5x margin for the heaviest case. **Monad-measured on 2026-10-11** (`eth_estimateGas`): one quote costs at most 141k
  against the 300k cap (at least 2.1x) and a whole raw swap, an upper bound of the leg, at most 348k against 450k (at least 1.29x). An honest hook can burn about 5.5x the gas of our honest fixture before a cap
  stops it on the Ethereum schedule, roughly 3x to 3.6x once Monad's repricing is added (estimate).
* **Retuning without a redeploy.** The owner can change both caps and the reserve within `GasBounds` (leg 350k to 1.5M, quote 200k to 1M,
  reserve 150k to 1M). The floors sit above the worst honest case measured so far, so a typo cannot start striking honest hooks; they also
  mean the owner cannot go below those floors without a redeploy. A wrongly struck hook is undone with `reinstate`, which is the owner's
  discretionary power (5.3).
* **Starvation is never blamed on a hook.** If the **caller** supplies too little gas, a failed quote or leg is not attributed to the hook:
  the whole call reverts with `InsufficientGas` (tested by sweeping gas limits).

## 6. Measurement honesty

- The hooks in the benchmark are our own. A 100% catch rate on `FixtureContextHook` shows the mechanism works; it is not a claim about the field.
- Between benchmark trials the owner reinstates BLOCKED hooks so every trial is a first encounter. In steady state a blocked hook is skipped without being tried.
- Local-fork results use Ethereum gas rules, not Monad's repriced schedule, and are labelled "fork-measured, not Monad-measured". Every gas figure in the repository is such a number or an estimate built on one until it is re-run on the real testnet; RESULTS.md keeps a separate, currently pending, testnet table for each.

## 7. Out of scope

MEV and sandwich protection; manipulation of honest pools; users who bypass FIRM; native-token pools; fee-on-transfer tokens; multi-hop routes and split orders; a trust-minimised attester set (owner and reporters are trusted roles here).
