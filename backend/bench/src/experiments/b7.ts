import { E18 } from "../ctx";
import { percentile, type ExperimentResult } from "../stats";
import type { Experiment } from "./types";

/** B7 Dashboard latency: seconds from transaction confirmation to the event being queryable in the indexer. */
export const b7: Experiment = async (ctx, cfg): Promise<ExperimentResult> => {
  const base = { id: "B7", title: "Dashboard latency", method: "Time from tx confirmation to the Fill appearing in the Envio GraphQL endpoint." };
  if (!cfg.envioUrl) {
    return { ...base, tables: [], notes: [], skipped: "ENVIO_GRAPHQL_URL is not set: no indexer to measure." };
  }
  await ctx.fund(500n * E18);
  const samples: number[] = [];
  let timeouts = 0;
  for (let i = 0; i < 10; i++) {
    const r = await ctx.firmSwap([ctx.route("C")], 5n * E18);
    const t0 = Date.now();
    let seen = false;
    while (Date.now() - t0 < 60_000) {
      const res = await fetch(cfg.envioUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `query($h: String!) { Fill(where: {txHash: {_eq: $h}}) { id } }`, variables: { h: r.tx.hash } }),
      }).catch(() => null);
      const body = res ? ((await res.json().catch(() => null)) as { data?: { Fill?: unknown[] } } | null) : null;
      if (body?.data?.Fill && body.data.Fill.length > 0) {
        seen = true;
        break;
      }
      await new Promise((r2) => setTimeout(r2, 250));
    }
    if (seen) samples.push((Date.now() - t0) / 1000);
    else timeouts++;
  }
  return {
    ...base,
    tables: [
      {
        table: {
          headers: ["Samples", "p50 (s)", "p95 (s)", "Timeouts (>60 s)"],
          rows: [[samples.length, percentile(samples, 50).toFixed(2), percentile(samples, 95).toFixed(2), timeouts]],
        },
      },
    ],
    notes: ["Latency is measured from the moment the receipt is observed, so it excludes block time but includes indexer ingestion and the 250 ms poll interval."],
  };
};
