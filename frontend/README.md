# frontend

Placeholder. The web app (Next.js App Router, React, Tailwind, wagmi v2 + viem, TanStack Query) is **not built yet**; this folder
only reserves its place in the layout.

Planned screens (spec section 12): `/` landing, `/swap` (protected vs raw swap with a live timeline), `/leaderboard`,
`/hooks/[address]`, `/arena`, `/integrate`.

It talks to the rest of the repo only through public interfaces:

* contract addresses and ABIs: `../deployments/10143.json` and `../backend/shared/src/abis`
* routes, hook scores and canary reports: the `backend/quote-api` HTTP API (`NEXT_PUBLIC_QUOTE_API_URL`)
* history and the live leaderboard: the Envio GraphQL endpoint (`NEXT_PUBLIC_ENVIO_GRAPHQL_URL`, see `../envio`)
* swap timeline text: `describeFirmLogs` from `@firm/shared` (`backend/shared/src/receipt.ts`)
