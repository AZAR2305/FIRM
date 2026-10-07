// Consistency check: does the Envio index agree with the Scoreboard contract, hook by hook?
//
//   ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql ENVIO_ADMIN_SECRET=testing pnpm check-indexer
//
// For every hook the indexer knows it compares status, fills, strikes, probes and probeStrikes with Scoreboard.stats()
// read from the chain. Any difference is a bug in a handler (or the indexer is still catching up). Exit code 1 on mismatch.
import { z } from "zod";
import { createRpcPool, loadDeployments, readHookStats, createLogger } from "@firm/shared";
import type { Address } from "viem";

const env = z
  .object({
    ENVIO_GRAPHQL_URL: z.string().url(),
    ENVIO_ADMIN_SECRET: z.string().optional().or(z.literal("").transform(() => undefined)),
  })
  .parse(process.env);

const log = createLogger("check-indexer");
const dep = loadDeployments();
const rpc = createRpcPool();

const res = await fetch(env.ENVIO_GRAPHQL_URL, {
  method: "POST",
  headers: { "content-type": "application/json", ...(env.ENVIO_ADMIN_SECRET ? { "x-hasura-admin-secret": env.ENVIO_ADMIN_SECRET } : {}) },
  body: JSON.stringify({ query: "{ Hook { id status fills strikes probes probeStrikes } }" }),
});
const body = (await res.json()) as { data?: { Hook: { id: string; status: string; fills: number; strikes: number; probes: number; probeStrikes: number }[] }; errors?: unknown };
if (!body.data) {
  log.error("indexer query failed", { errors: body.errors });
  process.exit(2);
}

let bad = 0;
for (const h of body.data.Hook) {
  const chain = await readHookStats(rpc.client, dep.core.scoreboard.address, h.id as Address);
  const pairs: [string, unknown, unknown][] = [
    ["status", h.status, chain.status],
    ["fills", h.fills, chain.fills],
    ["strikes", h.strikes, chain.strikes],
    ["probes", h.probes, chain.probes],
    ["probeStrikes", h.probeStrikes, chain.probeStrikes],
  ];
  const diffs = pairs.filter(([, a, b]) => a !== b);
  if (diffs.length) {
    bad++;
    console.log(`MISMATCH ${h.id}: ${diffs.map(([k, a, b]) => `${k} indexer=${a} chain=${b}`).join(", ")}`);
  } else {
    console.log(`ok       ${h.id}: ${chain.status}, fills ${chain.fills}, strikes ${chain.strikes}, probes ${chain.probes} (${chain.probeStrikes} struck)`);
  }
}
console.log(bad === 0 ? `\nindexer agrees with the Scoreboard for all ${body.data.Hook.length} hooks` : `\n${bad} hook(s) differ`);
process.exit(bad === 0 ? 0 : 1);
