# Submission pack

Everything needed to fill in the Monad Metropolis submission, with the status of each item. Deadline: 13 Oct 2026, 11:59 PM ET (we submit by 12 Oct). One project, one track:
**Track 1, Onchain Finance and Trading.**

## Checklist

| Item | Status | Notes |
|---|---|---|
| Public GitHub repo, MIT licence | **Needs you:** push | `LICENSE` is MIT. Local commits are not on GitHub until pushed. No secrets in git (`.env` is ignored; verified by search). |
| README: problem, solution, diagram, quick start, redeploy, limits, Why Monad, AI-tool statement | Done | `README.md` states that AI coding tools (Claude Code) were used. |
| DEPLOYMENTS.md: addresses, tx hashes, verification | Done | 37 transactions, 14 of 14 contracts verified on Sourcify. |
| RESULTS.md: tables split fork / Monad Testnet | Done | Testnet cells are filled only where measured; the 20-trial benchmark is **pending** and says so. |
| THREAT_MODEL.md, docs/SPIKES.md | Done | Limits are listed, including the sender-aware gap and the trusted owner. |
| Live demo URL | **Needs you:** host the frontend | `cd frontend && pnpm build` works from a clean checkout. It reads `../deployments/10143.json`, which is outside the `frontend/` folder: on a host that builds from a subfolder (Vercel) enable "include source files outside of the root directory", or ask us to add a committed copy. |
| Hosted Envio endpoint for the live app | **Needs you:** Envio account | Without it the live app labels itself "direct Scoreboard read". See `docs/DEMO.md`. |
| 60 to 90 second video | **Needs you:** record | Script and screens in `docs/DEMO.md`. |
| Team registered, rules modal re-read | **Needs you** | Confirm testnet is accepted: the platform page mentions Monad's chain id 143 (mainnet); the spec says testnet is accepted but second-hand. |
| Disclose pre-existing code / libraries | Done | README "Pre-existing code and libraries". |
| Sponsor bounties | See `docs/BOUNTIES.md` | Tick Envio. Kimi or Alibaba only after a real model run (needs a key). |

## Short description (for the project profile)

FIRM is a Uniswap v4 router and public scoreboard for Monad. A router ranks pools by a quote, but a hook can quote one price and deliver another. FIRM asks the pool's
quoter for a quote inside the swap transaction, executes at the identical state, rejects any pool whose real fill is below its own quote, strikes the hook publicly, and falls
back to the next pool. A canary probes hooks with dust swaps from several senders. On Monad Testnet the same 1,000-token trade returned 819.18 through an unprotected router and
998.20 through FIRM.

## The problem, and who has it

Routers and aggregators pick a pool by the quote a simulation returns. A v4 hook is code that runs inside the swap and can change the amounts, and it can behave differently
in the simulation than in the real swap (it sees a different caller or gas price). The trader, wallet or AI agent loses the difference silently, and no router remembers which hooks
did it, so the next user is hit too. 0x classified 54.2% of 84,163 analysed v4 hooks as malicious and 26.4% more as likely malicious (as of 11 Sep 2026; Uniswap's founder
disputes the framing). We quote it as 0x's classification, not ours, and make no estimate of real-world loss.

Who benefits: traders and agents (a swap that delivers the quote or falls back), routers and wallets (two on-chain reads, `statusOf` and `toleranceBps`, before routing), honest hook
builders and liquidity providers (a public track record earned from real fills).

## Why Monad

FIRM does more work per swap (a quote and a verification for every pool it tries, a Scoreboard write, continuous dust probes). That fits a chain with fast blocks and cheap block
space, where a strike is visible within a block or two. Uniswap v4 is already deployed on Monad Testnet and the ecosystem has discussed quote spoofing. Honest caveat: Monad charges
the gas **limit**, so protection is not free. Measured with `eth_estimateGas` on the public testnet: a protected swap needs a limit of 1.44x to 1.77x an unprotected one (about 0.012 to
0.025 MON extra at 102 gwei); a first route that burns gas costs about 1.0M gas once, then the hook is blocked. Monad's gas was about 1.5x to 1.6x what a fork predicted, which broke our first demo
script on the real chain; the limits are now set from the real measurements.

## What is built and verified (all on Monad Testnet unless stated)

* Contracts: `Scoreboard`, `FirmRouter`, `CanaryRunner` + `ProbeSender`, `RawRouter` (an unprotected comparator, labelled). 108 Foundry tests plus the router suite on a fork against the real PoolManager and Quoter.
* Deployment: one command (`contracts/script/Redeploy.sh`) with a balance preflight and an explicit gas limit on all 37 transactions; 14 contracts verified.
* Real demo swap: raw router 819.1792; FIRM rejected the cheating pool (quoted 998.997, delivered 819.1775, 1,799 bps), struck it, and filled the honest pool at 998.1997. Both transactions are linked on the proof page.
* Envio HyperIndex over HyperSync indexes the contracts and powers the leaderboard, activity feed and hook pages; `check-indexer` agrees with the Scoreboard for all 7 hooks.
* Frontend: landing (problem, evidence, cost), a guided judge demo, swap (raw vs protected, approval, simulation, timeline from receipt logs, a cheat picker), leaderboard, hook pages, proof, integrate; a block-explorer link after every transaction. Tested in a real browser against a fork and against the real testnet, failing on any console error.

## What we did not do, and what we do not claim

* The 20-trial benchmark B1 to B8 (about 560 transactions) was not run on the testnet; its results are from a fork and labelled so.
* We have not shown that real third-party malicious hooks are caught. The cheating hooks are our own fixtures.
* A hook that is honest to the router and cheats other callers is not caught by the router (0 of 20 in the fork benchmark); only the canary can catch it, and a hook that recognises probes defeats it.
* No language model has run: the arena is a scripted trader. Kimi and Qwen paths are implemented and tested against a mock only.
* One owner key controls the Scoreboard (it cannot move user funds). No timelock, no multisig.
* Gas caps trade false positives against griefing cost; the leg cap's margin over the heaviest fixture is only bounded from below on Monad (at least 1.29x).

## Description for the Envio bounty (about 2,000 characters; reported limit 8,000)

FIRM uses Envio HyperIndex, reading Monad Testnet through HyperSync, to power the leaderboard, live activity feed and per-hook pages of a Uniswap v4 protection layer.

The indexer (`envio/`) tracks four contract sets on chain 10143: FIRM's Scoreboard (FillRecorded, StrikeRecorded, ProbeRecorded, StatusChanged), FirmRouter (Filled, Rejected, LegSkipped, NoFill), CanaryRunner (ProbeDone) and the Monad Uniswap v4 PoolManager (Initialize, to discover pools and their hooks). Handlers write Hook, Pool, Fill, Strike, Probe, StatusChange and Skip entities, decode each hook's permission flags from its address, and keep per-hook counters that mirror the Scoreboard. Contracts never read the index; it is display and discovery only.

The web app reads Envio's GraphQL for its core screens: the leaderboard (status, fills, strikes, probes, average shortfall, last strike), a live feed of every fill, strike, probe, skip and status change with its transaction on the block explorer, and each hook's strike history. The leaderboard prints which source answered, the block Envio has indexed and how far behind the chain it is, so the claim is visible rather than asserted. If Envio is unavailable the app says so and falls back to reading the Scoreboard contract.

Correctness is tested: `pnpm check-indexer` compares the index with the Scoreboard contract for every hook, and on the real deployment it agrees for all 7 hooks; the same check found and fixed a handler bug earlier. On the real testnet, before FIRM existed, the index matched an independent HyperSync count of PoolManager Initialize events (70 of 70).

Real data flows through it: our demo swap on Monad Testnet (block 70,067,053) produced a Fill, a Strike (1,799 bps shortfall) and a status change UNRATED to BLOCKED that appear in the index and in the app within seconds. Limits, stated plainly: the data volume is small, the hooks are our own test fixtures, and the live demo's Envio endpoint is only as available as the instance hosting it.

Repo: `envio/` (config, schema, handlers), `frontend/src/lib/envio.ts` and `frontend/src/hooks/useBoard.ts` (client), `backend/bench/src/checkIndexer.ts` (consistency check), `docs/BOUNTIES.md`.
