# frontend

Next.js (App Router) + Tailwind + wagmi v2 + viem + TanStack Query. Screens (spec section 12):

| Route | What it does |
|---|---|
| `/` | one-sentence pitch, the 819 vs 998 example, the 0x evidence (54.2% malicious **together with** the 26.4% "likely malicious", attributed, with the dispute noted), Try the demo |
| `/swap` | pair and amount, route preview (quote, floor, hook, status), **Protected (FirmRouter)** vs **Raw (RawRouter, labelled unprotected comparator)**, a visible ERC-20 approval step, `simulateContract` before sending, an explicit gas limit, and a timeline built from the receipt logs (`LegSkipped`, `Rejected`, `Filled`, `NoFill`, plus `RawSwap`) |
| `/leaderboard` | hooks by status then strikes: status chip (text and colour), fills, strikes, probes, average shortfall, last strike; refreshes every 4 s |
| `/integrate` | how to read `Scoreboard.statusOf` and `toleranceBps` (viem and Solidity), deployed addresses, ABIs, router events |

A persistent banner says "Monad Testnet. Test tokens only.", links the faucet and has a **Mint test tokens** button (`MockToken.mint`).

## Data: only `deployments/10143.json`

Every contract address and ABI comes from `../deployments/10143.json` (written by `contracts/script/Redeploy.sh`, which embeds the
ABIs). `scripts/sync-deployments.mjs` copies it into `src/generated/` (git-ignored) before `dev`, `build` and `typecheck`.
There are no hard-coded addresses in the source. Chain id 10143, the RPC URL, the explorer and the faucet link are configuration
(`src/lib/config.ts`), not contract addresses.

* **No deployment yet** (true until a funded wallet runs `Redeploy.sh`): the sync writes a stub and every data page shows "FIRM is not
  deployed to Monad Testnet yet". The build still succeeds, which is what CI builds.
* **Fork build**: `FIRM_FORK=1` reads `10143.fork.json` and the app shows a red "LOCAL FORK BUILD" ribbon so it cannot be mistaken for the
  real testnet.

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
