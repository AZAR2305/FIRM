# Submission form: text to paste

Each block below is one field of the Monad Metropolis entry form. Numbers are from our own evidence files; nothing is rounded in our favour. Character counts are checked by `scripts/check-form-text.mjs`.

## Tagline (max 200 characters)

Replace the current one: FIRM has no bond or stake, and "bonded-quote" would make a judge look for one.

```
Checks each Uniswap v4 pool's quote against its real fill in the same transaction, strikes hooks that lie on a public Monad ledger, and falls back to an honest pool.
```

## Describe the problem, your solution, and what makes it useful (max 8,000)

```
THE PROBLEM
A Uniswap v4 pool can attach a "hook": code that runs inside the swap and can change the amounts. Routers and wallets pick a pool by the quote a simulation returns. A hook can answer the simulation one way and the real swap another (for example, it sees a different caller or gas price). The trader, wallet or AI agent loses the difference silently, and no router remembers which hook did it, so the next user is caught too. 0x classified 54.2% of 84,163 analysed v4 hooks as malicious and 26.4% more as likely malicious (as of 11 Sep 2026). That is 0x's classification, not ours, and Uniswap's founder disputes the framing. We make no estimate of real-world losses.

WHAT FIRM DOES
FirmRouter asks the Uniswap V4 Quoter for each candidate pool's quote inside the swap transaction, swaps at the identical state, and compares the real fill with that quote. If a pool delivers less, only that leg reverts, the hook gets a strike on a public on-chain Scoreboard, and the router tries the next pool. A severe or repeated shortfall BLOCKS the hook for every router that reads the Scoreboard. A hook that reverts or burns gas runs into a per-leg gas cap, so it cannot stop the swap. A canary swaps dust from several sender addresses to catch hooks that are honest only to routers they recognise. Contracts decide money and status; no model, oracle or server does.

PROOF ON MONAD TESTNET (chain 10143)
- The same 1,000 tUSD trade returned 819.18 tUSDC through an unprotected router and 998.20 through FIRM. The best-quoted pool (our test hook) quoted 998.997 and delivered 819.1775, 1,799 bps short. FIRM rejected it, struck it (UNRATED to BLOCKED), and filled the honest pool. Both transactions are linked on the proof page.
- 14 contracts deployed in one scripted run (37 transactions, each with an explicit gas limit) and all 14 verified on Sourcify.
- A Groq-hosted language model drove a trading agent on the testnet in a small smoke test. Taking the best quote, it lost 99 bps twice by choosing a pool that quotes high. The protected arm was unreliable: the models wrote bad tool arguments in some runs. We report this as a smoke test, not a benchmark.
- Envio HyperIndex indexes the contracts and powers the leaderboard, live activity feed and per-hook pages. A consistency check shows the index agrees with the Scoreboard contract for all 7 hooks.

WHAT IS IN THE PRODUCT
- Swap screen: the same trade through the protected router or an unprotected comparator, with approval, simulation, a timeline decoded from the receipt logs, and a block-explorer link after every transaction.
- Swap by message: write "swap 250 tUSD to tUSDC and send it to 0x..."; a model proposes the order, fixed code validates it against your text, FIRM quotes every pool, and your own wallet signs. The agent never holds keys.
- Leaderboard and hook pages: status, fills, strikes, probes and a plain-English summary per hook.
- Developers page: two read calls (statusOf, toleranceBps) let any router or wallet use the Scoreboard without our router. We compiled the Solidity sample and ran the TypeScript sample's reads on the testnet.
- An MCP tool server so an AI agent has one swap tool that always goes through the check.

WHY MONAD
FIRM does more work per swap: a quote and a check for every pool it tries, a Scoreboard write, and continuous dust probes. That fits fast blocks, where a strike is visible within a block or two. Honest caveat: Monad charges the gas limit, so protection is not free. Measured with eth_estimateGas on the public testnet, a protected swap needed 1.44x to 1.77x the gas limit of an unprotected one (about 0.012 to 0.025 MON extra at 102 gwei). Monad's gas was about 1.5x to 1.6x what a fork predicted, which broke our first demo script; the limits are now set from real measurements.

WHAT WE DID NOT DO, AND DO NOT CLAIM
- The 20-trial benchmark ran on a fork, not the testnet; one real trade ran on the testnet.
- The cheating hooks are our own test fixtures. We have not shown that real third-party malicious hooks are caught.
- A hook that is honest to the router and cheats other callers is not caught by the router (0 of 20 in the fork benchmark); only the canary can, and a hook that recognises probes defeats it.
- One owner key controls the Scoreboard (it cannot move user funds). There is no timelock or multisig yet.
- The Uniswap v4 deployment on Monad Testnet is Monad-maintained, not official. We are not affiliated with Uniswap Labs, Monad Foundation or Envio. Test tokens only.
- Built with AI coding tools (Claude Code).
```

## Who are your first users, and how will you reach them? (max 8,000)

```
We have no users yet and we will not pretend otherwise. This is a hackathon prototype on testnet. The plan, in order:

1. Routers and wallets on Monad that use Uniswap v4 pools. They have the problem (a quote they cannot verify, and support requests when users receive less) and the smallest integration cost: two read calls on a public contract, with no permission or key. We would reach them through open integration pull requests and direct conversations with the teams building routing on Monad.
2. Builders of AI trading agents. An agent that always takes the best quote is the easiest target, and FIRM's MCP tool gives it a swap path that always goes through the check. We would reach them through agent-framework communities and the Monad developer channels.
3. Honest hook builders and liquidity providers. They are lumped in with the hooks that cheat, and a public track record earned from real fills helps them. We would offer to run the canary against their hooks and publish the result, with the same rules for everyone: status is computed by contracts and cannot be bought.

What would change our mind: if routers say a 1.44x to 1.77x gas limit is too much for the protection, or if a real third-party hook turns out to defeat the check in a way our fixtures do not. We say so on the business page of the site (https://firm-gold.vercel.app/business), which also lists four possible revenue paths and marks every one as a proposal.
```

## Steps to try your product (private; max 8,000)

```
No login. You need a browser wallet (MetaMask or similar) and Monad Testnet MON.

1. Open https://firm-gold.vercel.app/ and press "Connect wallet". The button switches the wallet to Monad Testnet (chain 10143).
2. Get testnet MON from https://faucet.monad.xyz (check the address it fills in is yours).
3. Press "Mint test tokens" in the top bar and confirm both wallet prompts (10,000 tUSD and 10,000 tUSDC, free).
4. Open /swap?demo=1&mode=raw. Approve, then swap 1,000 tUSD through the UNPROTECTED router pointed at Pool B (our test hook that quotes the best price and hides a fee). You receive about 819, not 999.
5. Switch to Protected (/swap?demo=1&mode=protected) and run the same trade. The timeline shows the cheating pool rejected with the numbers, and an honest pool filling. Pool B may already be BLOCKED from earlier runs; the "cheat picker" lets you choose Pool G (burns all gas) or Pool R (reverts), which are caught the first time they are met. Every transaction has a block-explorer link.
6. Open /leaderboard to see the strike and the hook's status, read from Envio HyperIndex (the badge prints the source and how far behind the chain it is).
7. Try /agent and type: "Swap 250 tUSD to tUSDC". Add "and send it to 0x..." with any address to send the output to someone else. The agent prepares the swap; your wallet signs it.
8. /proof lists every address, both real transactions, the measured gas and what we did not run. /business and /pitch cover the case and a six-slide summary.

Note: only the two test tokens tUSD and tUSDC exist in the demo pools. Without a wallet you can still read /leaderboard, /proof, /business and /pitch.
```

## Envio: description (max 8,000)

```
FIRM uses Envio HyperIndex, reading Monad Testnet through HyperSync, to power the leaderboard, live activity feed and per-hook pages of a Uniswap v4 protection layer. It is deployed on Envio Cloud, and the live site (https://firm-gold.vercel.app/leaderboard) reads that hosted endpoint; the page prints "Data source: Envio HyperIndex" with the indexed block and how far behind the chain it is.

The indexer (envio/) tracks four contract sets on chain 10143: FIRM's Scoreboard (FillRecorded, StrikeRecorded, ProbeRecorded, StatusChanged), FirmRouter (Filled, Rejected, LegSkipped, NoFill), CanaryRunner (ProbeDone) and the Monad Uniswap v4 PoolManager (Initialize, to discover pools and their hooks). Handlers write Hook, Pool, Fill, Strike, Probe, StatusChange and Skip entities, decode each hook's permission flags from its address, and keep per-hook counters that mirror the Scoreboard. Contracts never read the index; it is display and discovery only.

The web app reads Envio's GraphQL for its core screens: the leaderboard (status, fills, strikes, probes, average shortfall, last strike), a live feed of every fill, strike, probe, skip and status change with its transaction on the block explorer, and each hook's strike history. If Envio is unavailable the app says so on screen and reads the Scoreboard contract directly instead.

Correctness is tested: a consistency check compares the index with the Scoreboard contract for every hook, and on the real deployment it agrees for all 7 hooks; the same check found and fixed a handler bug earlier. Before FIRM existed, the index also matched an independent HyperSync count of PoolManager Initialize events (70 of 70). A probe script (scripts/check-envio-endpoint.mjs) checks the hosted endpoint's queries, browser access from the live site and agreement with the chain.

Real data flows through it: our demo swap on Monad Testnet produced a Fill, a Strike (1,799 bps shortfall) and a status change UNRATED to BLOCKED, and the canary's probes (23 for the honest pool) appear in the index and the app within seconds.

Limits, stated plainly: the data volume is small, the hooks are our own test fixtures, and the hosted deployment is on Envio's free Development plan (deleted after 30 days, or after 7 days without requests), so its availability is only that of the instance.
```

## Envio: link

```
https://github.com/AZAR2305/FIRM/tree/main/envio
```

## Optional promotion

Not needed for judging. Leave blank unless you record a 30-second clip and have a project X account.
