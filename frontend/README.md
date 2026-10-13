# frontend

Next.js (App Router) + Tailwind + wagmi v2 + viem + TanStack Query. Screens (spec section 12):

| Route | What it does |
|---|---|
| `/` | the business case: pitch, **where the problem happens** (quote path vs execution path), the 0x evidence (54.2% **together with** the 26.4%, attributed, dispute noted), the 819 vs 998 example **computed from two real transactions** with explorer links, who pays and who gains, **what protection costs** (measured), what FIRM does not catch, built-on strip |
| `/demo` | the **judge walkthrough**: seven steps in the order that makes the point, a live panel of which cheating fixtures are not caught yet, and the 60 to 90 second presenter script |
| `/proof` | everything sourced: the two real transactions with decoded events, the 14 contracts with verification status, measured gas (first touch and later), the Envio check, and what was *not* run |
| `/hooks/[address]` | one hook: status, decoded permission flags, evidence, risk summary (`/api/hook-report`, deterministic; a model only if configured on the server), strike and fill history from Envio |
| `/swap` | pair and amount, route preview (quote, floor, hook, status), **Protected (FirmRouter)** vs **Raw (RawRouter, labelled unprotected comparator)**, a visible ERC-20 approval step, `simulateContract` before sending, an explicit gas limit, a timeline built from the receipt logs (`LegSkipped`, `Rejected`, `Filled`, `NoFill`, plus `RawSwap`), an explorer link after every transaction, and in demo mode (`?demo=1&mode=raw\|protected`) a **cheat picker** that puts one of our own cheating fixtures first |
| `/leaderboard` | hooks by status then strikes: status chip (text and colour), fills, strikes, probes, average shortfall, last strike; powered by **Envio** with the source, indexed block and lag printed on screen, plus a live activity feed; refreshes every 4 s |
| `/integrate` | how to read `Scoreboard.statusOf` and `toleranceBps` (viem and Solidity), deployed addresses, ABIs, router events |

A persistent banner says "Monad Testnet. Test tokens only.", links the faucet and has a **Mint test tokens** button (`MockToken.mint`).

## Design

A warm cream and plum palette (CSS tokens in `src/app/globals.css`, so every page follows), rounded pill buttons, a bento feature grid, a pill row, integration tiers by effort and a four-column footer: the *structure and feel* of a modern SaaS landing page (the reference was a Fibery-style page). **All copy and artwork are our own.** The hero is "FIRM City", an original isometric illustration generated from data (`src/components/city/`): one district per idea (Uniswap v4 Quarter, Quote Street, Hook Hill, Cheaters' Alley, Honest Park, Scoreboard Tower, Canary Coop, Monad Harbour, Envio Observatory). It is draggable, each sign is a keyboard-operable button, and the same text is listed as plain HTML under the picture. The "what we focus on" cards carry original background art (a liquidity-curve motif for Uniswap v4, a chain of blocks for Monad). Uniswap, Monad and Envio appear as plain names only: no logos are reproduced, and the footer states that FIRM is not affiliated with them.

## Data: only `deployments/10143.json`

Every contract address and ABI comes from `../deployments/10143.json` (written by `contracts/script/Redeploy.sh`, which embeds the
ABIs). `scripts/sync-deployments.mjs` copies it into `src/generated/` (git-ignored) before `dev`, `build` and `typecheck`.
There are no hard-coded addresses in the source. Chain id 10143, the RPC URL, the explorer and the faucet link are configuration
(`src/lib/config.ts`), not contract addresses.

* **No deployment yet** (true until a funded wallet runs `Redeploy.sh`): the sync writes a stub and every data page shows "FIRM is not
  deployed to Monad Testnet yet". The build still succeeds, which is what CI builds.
* **Fork build**: `FIRM_FORK=1` reads `10143.fork.json` and the app shows a red "LOCAL FORK BUILD" ribbon so it cannot be mistaken for the
  real testnet.

**Evidence.** `deployments/10143.evidence.json` (written by `scripts/build-evidence.mjs`) is synced next to the deployments file. It holds the decoded events of the real
transactions and `eth_estimateGas` measurements read from the chain; the landing and proof pages compute their numbers from it, nothing is typed into the components. Without it
those pages say no evidence was generated.

**Envio.** Set `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` **at build time** (e.g. `http://localhost:8080/v1/graphql`) and the leaderboard, activity feed and hook pages read Envio HyperIndex.
Unset, or if Envio does not answer, the leaderboard reads the Scoreboard contract directly and prints "direct Scoreboard read (Envio not used)"; the activity feed then says it needs Envio.
Hosting that endpoint for judges is not done (see `docs/DEMO.md`).

**Optional LLM (server only).** `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` in the frontend server's environment let `/api/hook-report` have a model rewrite the deterministic hook
summary; the page then says "AI-written, advisory". They are never sent to the browser. No model has been run yet.

Environment (all optional): `NEXT_PUBLIC_RPC_URL` (default `https://testnet-rpc.monad.xyz`; `NEXT_PUBLIC_*` is inlined at build time),
`NEXT_PUBLIC_QUOTE_API_URL` (reserved; the route preview is computed in the browser with quote-api's ordering rules, so no backend is needed).

## Commands

```bash
cd frontend
pnpm install
pnpm dev            # sync deployments, then next dev
pnpm typecheck
pnpm test           # vitest: route ordering, timeline wording (spec 12.4), formatting
pnpm build && pnpm start
```

## How a swap is sent

1. **Approve** (visible step 1): exact amount, to the router of the selected mode.
2. **Simulate** (step 2): `simulateContract` with the current gas price, because some hooks behave differently at gas price 0, plus
   `estimateContractGas`. The result is shown as the predicted outcome. If the simulation reverts, nothing can be sent.
3. **Send** (step 3): the transaction carries an explicit gas limit = estimate + 20%. **Monad charges the gas limit**, so the UI prints it.
   The fixed limits in `config.ts` (mint, approve fallback) are fork-measured, not Monad-measured.
4. The receipt's logs become the timeline; `NoFill` shows that the input was returned and strikes were recorded.

## Block explorer links

After every confirmed transaction the app shows its hash and "View on block explorer" (`https://testnet.monadexplorer.com/tx/<hash>`, opens in a
new tab): each mint (in the banner), the approval (in step 1) and the swap (in the timeline). Addresses link to `/address/<address>`. That host
redirects to MonadVision and keeps the `/tx/` and `/address/` paths. The browser test asserts every one of these links.

## Reading the chain: Multicall3, because the public RPC is rate limited

The public Monad RPC allows about **15 requests per second per client and counts each call of a JSON-RPC batch** (checked: a batch of 20 is
rejected with "requests limited to 15/sec"). The route preview, leaderboard and balances therefore read many values in **one** Multicall3
`eth_call` (the address comes from `deployments/10143.json`). The first version read each value separately; it worked on the fork (no limit)
and failed on the real network, which only the real-testnet test below could show.

## Test against the REAL testnet (read-only, no wallet)

`e2e/real-testnet-readonly.spec.ts` runs the app built from the real `deployments/10143.json` against the public RPC: the leaderboard shows the
state the real demo swap left (Pool B BLOCKED, 1 strike, 18.0% average shortfall; Pool C 1 fill), the route preview excludes B, and the Integrate
page shows the real addresses with explorer links, with no console errors.

```bash
cd frontend && pnpm build                      # without FIRM_FORK / NEXT_PUBLIC_RPC_URL
FIRM_REAL_E2E=1 npx playwright test e2e/real-testnet-readonly.spec.ts
```

## End-to-end test (real browser, local fork)

`e2e/demo-path.spec.ts` drives the whole demo in Microsoft Edge (installed with Windows; `PW_CHANNEL=chrome` to change): landing,
connect, mint, a Raw swap through Pool B (819.2), a Protected swap (Pool Q skipped, Pool B rejected at -18.0%, Pool C filled at 998.2),
the leaderboard turning Pool B BLOCKED, the integrate page. It **fails on any console error, page error or failed request**, checks the
transaction carried the gas limit shown in the UI, and has a phone-width overflow test and an RPC-down test. The wallet is a small
EIP-1193 shim that forwards to the fork's unlocked dev account; it holds no key.

```bash
# 1. fork + fresh deployment (the test needs Pool B not yet struck)
wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-anvil.sh start
cd contracts && MONAD_TESTNET_RPC_URL=http://127.0.0.1:8546 ./script/Redeploy.sh      # fund the deployer on the fork first
# 2. build the app from that deployment (pnpm build syncs it; plain `next build` does NOT)
cd ../frontend && FIRM_FORK=1 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8546 pnpm build
# 3. run
pnpm e2e
```

The test takes an `evm_snapshot` and reverts it, so it can be re-run on the same fork. Without a fork the main test skips with a message.
It is not run in CI (it needs the fork); CI runs typecheck, unit tests and the build.

## Limits

* Wallets: browser (EIP-1193) wallets only; no WalletConnect, no passkeys (spec 12.5 P2).
* Not built: `/hooks/[address]` and `/arena` (spec P1/P2). The route preview does not use quote-api or the Envio indexer; the leaderboard
  reads the Scoreboard contract directly, so it shows the hooks of the seeded pools only, not every hook ever seen.
* Not Lighthouse-audited. Semantics are in place (roles, labels, focus outlines, text with every colour) but no automated accessibility score was run.
