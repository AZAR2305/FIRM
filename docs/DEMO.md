# Demo guide: showing FIRM to judges

The live app has a guided page, `/demo`, that follows exactly this order. This file is for the person presenting or recording.

## The story in one breath

A router ranks pools by a quote. A Uniswap v4 hook can quote one price and deliver another, and no router remembers which hooks did. FIRM checks the fill against the quote inside the same transaction, strikes the cheat in public, and falls back to an honest pool. It costs more gas, and we say how much.

## Before you start (5 minutes, once)

1. A browser wallet (MetaMask or similar) with a Monad Testnet account. The app's **Connect wallet** button switches the network. Testnet MON from <https://faucet.monad.xyz>. If the faucet fills in an address for you, check it is the one you want before claiming.
2. Open the app. Press **Mint test tokens** (two wallet confirmations, 10,000 tUSD and 10,000 tUSDC).
3. Check the leaderboard's **Data source** badge says *Envio HyperIndex*. If it says *direct Scoreboard read*, the Envio endpoint is not configured or is down; the app still works and says so (see "Envio" below).
4. Look at the **Live state of the cheats** on `/demo`. It shows which of Pools B, G and R have already been caught.

## The flow (about 3 minutes)

| # | Screen | What to say | What to point at |
|---|---|---|---|
| 1 | `/` (problem section) | "A quote comes from a simulation. The hook sees a different caller in the real swap." | the two-lane diagram; the 0x quote with its caveat |
| 2 | `/swap?demo=1&mode=raw` | "Same trade, naive router. The best quote said 999." | approve, swap; the result is about 819 and the timeline says the raw router checked nothing |
| 3 | `/swap?demo=1&mode=protected` | "Now FIRM, with a cheat ranked first." | the **cheat picker** (it defaults to a cheat that has not been caught yet); simulate, swap; the timeline shows *Rejected* with the numbers, then *Filled* by an honest pool |
| 4 | the explorer link under the timeline | "One transaction. Anyone can verify it." | "View on block explorer" |
| 5 | `/leaderboard` | "The strike is public, for every router, indexed by Envio." | the red status, the Envio badge with the indexed block, the live activity feed |
| 6 | `/hooks/<address>` | "Here is what the hook is allowed to do, and its strike history." | the decoded permissions (the amount-changing flag), the strike with its transaction |
| 7 | `/proof` | "Everything is checkable: two real transactions, 14 verified contracts, measured gas." | the cost table; the "what we did not run" section |

The three cheats are our own test fixtures: **B** takes a hidden 18% fee, **G** burns all its gas, **R** reverts. Each can be caught once; after that the router skips it (which is the protection for the next user). That is why the picker lists all three.

## If a cheat has already been caught

Choosing a caught cheat still works: the timeline shows the router **skipping** it ("hook is BLOCKED"), which is the point of a shared scoreboard. To catch one *live* again, the owner can move it back to WATCH:

```bash
node scripts/demo-reset.mjs --dry-run --hooks B,G,R     # shows what would be sent
node scripts/demo-reset.mjs --hooks B                   # about 0.008 MON, owner key from .env
```

This does not erase history: the earlier strike stays in the counters and the transaction log, and a reinstated hook that cheats again is struck again. Say so if asked.

## The 60 to 90 second script (for the video)

| Time | Screen | Narration |
|---|---|---|
| 0:00 | landing | "Routers rank pools by their quote. Hooks can lie about it. 0x classed 54.2% of v4 hooks as malicious and 26.4% more as likely malicious. That is 0x's classification, and Uniswap's founder disputes it." |
| 0:15 | `/swap` raw | "Same trade, naive router. The best quote said 999. We receive 819. About 180 tokens gone." |
| 0:30 | `/swap` protected | "Now FIRM. It quotes, executes, sees the shortfall, reverts that leg, and tries the next pool." |
| 0:45 | timeline, then leaderboard | "We received 998.2. And the hook is now publicly red for every router, indexed by Envio within seconds." |
| 1:00 | `/proof` | "Everything is on Monad Testnet and verifiable. Protection costs about 1.4 to 1.8 times the gas, and here is what we do not catch." |

Do not say: that FIRM catches real malicious hooks (it caught our own fixtures), that gas is "free" on Monad (Monad charges the gas limit), or that the 20-trial benchmark ran on the testnet (it ran on a fork; one real trade ran on the testnet).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Could not read the pools" or "requests limited to 15/sec" | The public Monad RPC allows about 15 requests per second. The app reads through one multicall per refresh; if several people share one network, set `NEXT_PUBLIC_RPC_URL` to a private RPC and rebuild. |
| Wallet shows another network | Press the app's **Switch to Monad Testnet** button. |
| Swap simulation fails | Approve first; check the token balance; the simulation uses the current gas price and the real router, so a failure is real. |
| Leaderboard says "direct Scoreboard read" | Envio is not configured or did not answer. It is stated on screen. Configure `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` at build time. |
| "Pool B already caught" | Expected after the first demo. Use the cheat picker (G or R), or run the reset script above. |

## Envio for the live demo

The leaderboard, activity feed and hook pages read Envio's GraphQL endpoint (`NEXT_PUBLIC_ENVIO_GRAPHQL_URL`, set when the app is built). Locally that is `http://localhost:8080/v1/graphql` after `envio/README.md` steps. For judges who cannot reach your machine the endpoint must be a **hosted** Envio instance. **This is done**: the live site (<https://firm-gold.vercel.app>) reads the Envio Cloud deployment `https://indexer.dev.hyperindex.xyz/41f18b3/v1/graphql` (Development plan, Monad Testnet, built from the `envio` branch). On 13 Oct 2026 `scripts/check-envio-endpoint.mjs` passed every check against it (CORS for the live site, all 7 hooks equal to the Scoreboard) and the leaderboard badge read "Envio HyperIndex, 0 behind the chain". Limits: it is a Development deployment (deleted after 30 days, or after 7 days without requests), and the URL belongs to that deployment, so a redeploy can change it. If the endpoint is down the app falls back to reading the Scoreboard contract and labels itself accordingly.
