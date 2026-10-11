# Sponsor bounties: what we claim, with evidence, and what we do not

Source: the Metropolis page at <https://monad.xyz/developers/hackathons/metropolis> (read 2026-10-11). It lists bounty titles and amounts only; the detailed
requirements are on each sponsor's page on the hackathon platform, which we have **not** read. Anything below about scoring or required materials
comes from secondary sources and is marked.

## Decision

FIRM solves one problem (a quote that a hook can falsify). We only pursue bounties that use technology FIRM already needs for that problem. We do not bolt on
unrelated integrations to collect prizes.

| Bounty | Amount | Fit | Decision |
|---|---|---|---|
| **Envio: Best Use of Envio** | $1,000 | **Strong.** HyperIndex and HyperSync power the leaderboard, activity feed and hook pages. | **Pursue.** Evidence below. |
| **Kimi: Best Builds Powered by KIMI** | $3,000 credits | Medium. The hook risk summary and the canary report can use any OpenAI-compatible model. | **Pursue only if you supply a Kimi key.** Code is ready; nothing has run with a model. |
| **Alibaba Cloud: Best Builds with Qwen** | $5,000 credits | Medium, same code path. | **Pursue only if you supply a Qwen key.** One of Kimi or Qwen is enough to show the path. |
| Perpl (analytics / risk tool), Chainlink (CRE), Nansen, Dynamic, Privy, Mera (Monad Foundation), MetaMask agent plugin, Kuru, Agora, Cleanverse, Alchemy, Aurora, Tencent | various | Weak or none: each needs an integration unrelated to quote-versus-fill. | **Not pursued.** Saying so is better than a token integration. |

The "sponsored prizes for winners" (Chainstack, BlockVision, Envio Cloud hosting and others) are awarded to winning teams, not applied for.

## Envio: the evidence

What the bounty asks, as reported by secondary sources (verify on the platform): the project must meaningfully use HyperIndex, HyperSync or HyperRPC to power real
on-chain data behind a core feature; a written description (reported limit 8,000 characters); an optional demo video of at most 2 minutes. Reported scoring:
adherence to the bounty 40%, technical implementation 30%, Monad integration 20%, innovation 10% (not confirmed by an official source).

| Claim | Where to check it |
|---|---|
| Envio HyperIndex indexes FIRM's own contracts and Uniswap v4's `PoolManager.Initialize` on Monad Testnet | `envio/config.yaml` (start block 70,065,928, the real addresses), `envio/schema.graphql`, `envio/src/EventHandlers.ts` |
| HyperSync mode against the real chain | `chain_metadata.is_hyper_sync = true` on the running index; the free API token is read from the environment (`ENVIO_API_TOKEN`), never committed |
| A **core feature** reads from it | The leaderboard, the live activity feed and every hook page read Envio's GraphQL when `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` is set (`frontend/src/hooks/useBoard.ts`, `frontend/src/lib/envio.ts`). The page prints which source answered, the indexed block and how far behind the chain it is. |
| The index is **correct** | `cd backend/bench && pnpm check-indexer` compares the index with the Scoreboard contract for every hook: on the real deployment, "agrees for all 7 hooks" (2026-10-11). Before FIRM existed, the index also matched an independent HyperSync count of PoolManager events (70 of 70). A handler bug was found by this check earlier and fixed. |
| Real data flowing | the real demo swap produced a Fill, a Strike and a StatusChange in the index, each with its transaction (see the activity feed and `/hooks/<address>`) |
| Tests | `frontend/test/business.test.ts` (Envio client, query building, feed merge, error mapping against a mocked endpoint, labelled as mocked); `frontend/e2e/real-testnet-readonly.spec.ts` with `FIRM_REAL_E2E_ENVIO=1` runs the real build against the real chain and real index |

**Honest limits.** The data volume is small (one real swap, 70 other pools from the chain). The index runs on our machine; **a hosted Envio endpoint for judges does
not exist yet** (your Envio account is needed). Without it, the deployed app labels itself "direct Scoreboard read (Envio not used)". Envio is display and discovery
only: no contract reads it.

## Kimi / Alibaba (Qwen): what is built, what is not

Built:
* `frontend/src/lib/report.ts` and `GET /api/hook-report?hook=0x...`: a risk summary for a hook. The text is a deterministic template filled from on-chain facts. If
  `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` are set **on the server**, a model rewrites it in at most four sentences, from those facts only, and the page says
  "AI-written, advisory (model: ...)". Output is sanitised and never parsed for decisions. If the endpoint fails, the deterministic text is used and says why.
* `backend/canary-agent` (report prose) and `backend/trader-agent` (a tool-calling agent that always takes the best quote, with and without FIRM) use the same OpenAI-compatible
  settings.
* Tests with a **mocked** endpoint (`frontend/test/business.test.ts`, backend agent tests): the request shape, fallback and sanitising.

Not done: **no run with a real model.** No key is configured, so the arena result is labelled `"mode": "scripted"` and the hook summary says "No language model was used".

To enable: put the three variables in `.env` (backend) and in the frontend server's environment, rerun the arena (`pnpm --filter @firm/trader-agent start`), and record the model name in
`RESULTS.md` as `"mode": "llm"`. For Kimi use Moonshot's OpenAI-compatible endpoint and a tool-calling model; for Alibaba use the DashScope compatible-mode endpoint (check each
provider's current documentation for the exact base URL and model id; we have not verified them).

## What to tick on the submission form

Envio, yes. Kimi or Alibaba only after a real run exists. Nothing else.
