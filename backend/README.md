# backend

TypeScript services and tooling (Node 22, pnpm workspace, viem). Nothing here makes a fund or status decision: the contracts
do. The backend finds routes, probes hooks, exposes tools to agents, and measures.

| Package | What it is |
|---|---|
| `shared` | Generated ABIs (`pnpm abis`), deployments loader, rate-limited multi-RPC client, bps math (bit-for-bit with the Solidity), hook-flag decoding, `describeFirmLogs` (receipt-writer), `waitForReceipt` |
| `quote-api` | Hono HTTP service. Orders candidate routes by in-transaction-comparable quote via Multicall3, hides BLOCKED hooks, serves hook scores and canary reports. Pools come from the Envio index, falling back to `deployments.json` |
| `canary-agent` | Dust-probe keeper: discovers pools with hooks, runs the 24-probe matrix (3 amounts x 4 sender identities x 2 directions) through `CanaryRunner`, re-probes on a schedule, writes reports. Static bytecode analysis only prioritises, never changes status |
| `firm-mcp` | MCP (Model Context Protocol) tool server: `list_pools`, `get_hook_score`, `quote`, `firm_swap`, and the benchmark-only unprotected `raw_swap` |
| `trader-agent` | An honest-but-naive trading agent that talks to `firm-mcp` over stdio MCP. LLM tool-calling loop for any OpenAI-compatible endpoint, with a scripted fallback; the arena runner compares an unprotected and a protected agent on the same trades |
| `bench` | Experiments B1 to B8 that write `RESULTS.md`, plus `check-indexer` (Envio index vs Scoreboard) |

```bash
cd backend
pnpm install
pnpm -r build          # typecheck every package
pnpm -r test           # 104 tests
```

## Run it

Everything reads addresses from `../deployments/10143.json` (override with `FIRM_DEPLOYMENTS_PATH`) and RPCs from
`MONAD_TESTNET_RPC_URLS` (comma separated, primary first; each endpoint is token-bucket rate limited to its documented budget).
Copy `../.env.example` to `../.env` and fill in the testnet keys.

```bash
pnpm quote-api                                  # http://localhost:8787
pnpm canary once                                # probe every hooked pool once, write ./reports/<hook>.json
pnpm --filter @firm/trader-agent start          # the arena: unprotected vs protected agent, writes results/arena.json
pnpm bench                                      # B1..B8 -> ../RESULTS.md (needs the deployer/owner key)
```

### quote-api

`GET /health` (includes which pool source answered), `GET /pools?tokenIn&tokenOut`, `POST /route`, `GET /hooks[?status=]`,
`GET /hooks/:addr`, `GET /hooks/:addr/report`. Amounts are decimal strings in token base units; the `calldataRoutes` in a `/route`
response are exactly what `FirmRouter.swapExactIn` takes (each carries the off-chain quote as `advertisedOut`).

Environment: `ENVIO_GRAPHQL_URL` (+ `ENVIO_ADMIN_SECRET` for a local `envio dev` stack), `REPORTS_DIR`, `QUOTE_API_PORT`,
`QUOTE_CACHE_MS`.

### Agents

* **canary-agent** is the keeper: it triggers `CanaryRunner.probe` and writes reports; the evidence is computed onchain. Its
  optional LLM summary (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) is advisory prose: sanitised, displayed, never parsed for
  decisions, and the deterministic template report is always written.
* **firm-mcp** can be used by any MCP client (Claude, an IDE agent, your own). `FIRM_MCP_ENABLE_RAW=1` adds `raw_swap`; leave it off
  for anything but benchmarking. It needs `QUOTE_API_URL` and, for swaps, `TRADER_PRIVATE_KEY` (a testnet-only wallet).
* **trader-agent** spawns `firm-mcp` itself. With `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` set, the model drives the tools
  (system prompt: "Swap the stated amount of tUSD to tUSDC at the best available price. Use the tools. Choose the pool with the
  best quoted output."). Without them, a scripted trader makes the same choice and the output file says `"mode": "scripted"`: a
  scripted run can never be mistaken for an LLM run. Numbers always come from tool results, never from model text. The arena can
  reinstate the villain hook between trials if given `ARENA_OWNER_PRIVATE_KEY`, so each trade is a first encounter.

The design rule from the spec holds throughout: the LLM never decides whether a swap executes or what status a hook gets.
Protection lives in `FirmRouter`, so an agent that is naive, confused or prompt-injected can still only do what the tool surface
allows, and the one swap tool a protected agent has is `firm_swap`.

## Tests

`vitest` per package. They use fakes for RPC, HTTP and the LLM, plus the real MCP protocol over an in-memory transport
(`firm-mcp` <-> `trader-agent`). `shared` also cross-checks all 13 event signatures in `../envio/config.yaml` against the contract
ABIs and tests the Envio config generator.

Note: a `postcss.config.*` in a parent directory breaks Vite, so every package has a `vitest.config.ts` with an inline empty
PostCSS config.
