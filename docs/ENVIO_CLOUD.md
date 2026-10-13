# Putting Envio on the live site (Envio Cloud)

**Status, 13 Oct 2026: done.** Indexer `firm` (Development plan) deployed from the `envio` branch; Envio Cloud accepted envio 3.14.0 and needed no environment variable (that page is a paid feature). Endpoint `https://indexer.dev.hyperindex.xyz/41f18b3/v1/graphql` passed `scripts/check-envio-endpoint.mjs` for origin `https://firm-gold.vercel.app`, and the live leaderboard shows "Envio HyperIndex". The steps below are what was followed; the "unverified" notes are kept as they were written.

The live site reads its leaderboard, activity feed and hook pages from an Envio GraphQL endpoint. Judges cannot reach an indexer running on your machine, so it must be
hosted. This is what to do. Everything marked **(unverified)** comes from Envio's documentation and could not be tested without your account.

Sources: [hosted service deployment](https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment), [hosted service overview](https://docs.envio.dev/docs/HyperIndex/hosted-service).

## What is already prepared (and tested)

| Item | Status |
|---|---|
| `envio/` is self-contained (no imports outside the folder), under 100 MB, with a `package.json` that pins `envio` to `3.14.0` | checked |
| `envio/pnpm-lock.yaml` (the docs name pnpm 10.32.0) | generated |
| A clean-directory build with pnpm 10.32.0: install, codegen, type check | **passes**: `wsl -d Ubuntu -- bash scripts/wsl-envio-sim-check.sh` |
| `envio/config.yaml` points at the real deployment, start block 70,065,928, Monad Testnet (chain 10143) | done |
| No secret in any commit (checked the whole history for the Envio token and all three private keys) | clean |
| A probe for the hosted endpoint: `node scripts/check-envio-endpoint.mjs <url> --origin <site>` | tested against a real index |
| The app falls back, and says so on screen, if the endpoint is missing, down, or does not expose `chain_metadata` | done |

## What you do (about 15 minutes, plus the first sync)

1. **The repository must be on GitHub.** Envio deploys from your repository, so push first (`git push origin main`). Nothing else works without it.
2. Log in at <https://envio.dev/app> with GitHub and choose your organisation or personal account.
3. **Install the "Envio Deployments" GitHub App** and grant it access to `AZAR2305/FIRM`.
4. **Add an indexer** for that repository with:
   * **Root directory:** `envio`
   * **Config file:** `config.yaml`
   * **Deployment branch:** a name you choose, for example `envio-deploy`
5. In the indexer's **Settings, Environment Variables**, add `ENVIO_API_TOKEN` with your HyperSync token (the value in your `.env`). Envio requires every variable to start with
   `ENVIO_`. **(unverified)** whether the cloud needs your own token or supplies one; adding it is harmless.
6. **Push to the deployment branch** to trigger the build: `git push origin main:envio-deploy` (use the branch name you chose).
7. Watch the dashboard until it is **synced**. It re-indexes from the start block on every push; the previous deployment keeps serving until the new one has caught up.
8. **Find the GraphQL endpoint URL in the dashboard** **(unverified: the docs do not say where it appears)**. It ends in `/v1/graphql`.
9. **Check it**, with the address of your live site:
   ```bash
   node scripts/check-envio-endpoint.mjs https://<your endpoint>/v1/graphql --origin https://<your live site>
   ```
   It must end with "All checks passed". If CORS fails, the docs mention domain whitelisting for endpoints: add your live site's domain in the dashboard.
10. **Put the URL into the site build** as `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` (it is read at *build* time, so rebuild and redeploy the frontend), then open `/leaderboard`: the
    badge must say "Data source: Envio HyperIndex" and show the indexed block.

## Limits you should know

From the docs (they may change):

* Development plan: **3 indexers per organisation**, 3 deployments per indexer.
* **Hard limits:** a deployment is deleted automatically after **30 days** or at 20 GB. A deployment made today would be deleted around 12 November, after judging (14 to 27 Oct) and the winners (3 Nov). Redeploy
  later if you want it to outlive that.
* **Soft limits** (whichever comes first): 100,000 events processed, 5 GB, or **no requests for 7 days**. Then a 7-day grace period, 3 days read-only, then deletion. FIRM's
  index is small (our contracts plus the PoolManager's pool-creation events), far below these.
* Every push to the deployment branch re-indexes from block 70,065,928. Do not push to it casually near judging.

## Things that could go wrong

| Risk | What happens | What to do |
|---|---|---|
| Envio Cloud rejects `envio 3.14.0` | The docs say "at least 2.21.5", that 2.29.x is unsupported and to use the latest release; 3.x is not mentioned. **(unverified)** | Read the build log in the dashboard and send it to me. Do not downgrade blindly: our config and handlers use the 3.x format. |
| The endpoint is not publicly readable, or blocks browsers | The probe fails on CORS or on the queries | Whitelist the live site's domain in the dashboard. If it still fails, the site keeps working: it labels itself "direct Scoreboard read (Envio not used)". |
| The endpoint does not expose `chain_metadata` | The page says it cannot report the lag | Nothing; this is handled. |
| The sync is slow or stuck | The probe reports the index is far behind, or hooks disagree with the chain | Wait, then rerun the probe. |
| You run out of time | The live site works without Envio and says so | Do not claim Envio is powering the live site until the badge says so. |

## For the submission

Only describe Envio as powering the live site if the live site's leaderboard badge reads "Data source: Envio HyperIndex". The bounty text in `docs/SUBMISSION.md` states that the live demo's endpoint
is only as available as the instance hosting it; keep that sentence.
