import type { Address, Hex } from "viem";
import { shortfallBps, type RouteT } from "@firm/shared";
import { E18 } from "../ctx";
import { bps, mean, sum, tok, type ExperimentResult } from "../stats";
import type { Experiment } from "./types";

interface ApiRoute {
  poolId: Hex;
  quotedOut: string;
  key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
}

/**
 * B8 Agent arena (scripted trader, no LLM; fallback F6): an agent that always picks the best quoted pool from the real
 * quote-api. Run A sends it through the unprotected RawRouter, run B through FirmRouter with the same candidate routes.
 * The LLM trader of spec 11.2 would make the same choice: the point is that protection lives in the contract.
 */
export const b8: Experiment = async (ctx, cfg): Promise<ExperimentResult> => {
  const base = {
    id: "B8",
    title: "Agent arena (scripted trader)",
    method: `${cfg.trials} trades of varied size (100 to 2,000 tUSD) by a scripted agent that picks the best quote from quote-api: once through RawRouter, once through FirmRouter with the same routes.`,
  };
  if (!cfg.quoteApiUrl) return { ...base, tables: [], notes: [], skipped: "QUOTE_API_URL is not set: start quote-api and set it to run B8." };

  await ctx.fund(60_000n * E18);
  const nameOf = new Map(Object.entries(ctx.dep.pools!.list).map(([n, p]) => [p.poolId.toLowerCase(), n]));
  const rows: (string | number)[][] = [];
  const rawShort: bigint[] = [];
  const firmShort: bigint[] = [];
  const rawLost: bigint[] = [];
  const firmLost: bigint[] = [];
  let firmFilled = 0;

  for (let i = 0; i < cfg.trials; i++) {
    const tokens = 100n + BigInt((i * 100) % 1900); // 100 .. 2000
    const amount = tokens * E18;
    // every trade is a first encounter with the villain
    await ctx.reinstateIfBlocked(ctx.hook("B"));

    const res = await fetch(`${cfg.quoteApiUrl}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenIn: ctx.tokenIn, tokenOut: ctx.tokenOut, amountIn: amount.toString() }),
    });
    if (!res.ok) throw new Error(`quote-api ${res.status}`);
    const body = (await res.json()) as { routes: ApiRoute[]; calldataRoutes: (Omit<RouteT, "advertisedOut"> & { advertisedOut: string })[] };
    const best = body.routes[0];
    if (!best) throw new Error("quote-api returned no routes");
    const bestName = nameOf.get(best.poolId.toLowerCase()) ?? best.poolId.slice(0, 10);
    const bestQuote = BigInt(best.quotedOut);

    const raw = await ctx.rawSwap(nameOf.get(best.poolId.toLowerCase())!, amount);
    const routes: RouteT[] = body.calldataRoutes.map((r) => ({ ...r, advertisedOut: BigInt(r.advertisedOut) }));
    const firm = await ctx.firmSwap(routes, amount);
    if (firm.events.filled) firmFilled++;

    const rs = shortfallBps(bestQuote, raw.out);
    const paid = firm.events.filled;
    const fs = paid ? shortfallBps(paid.quotedOut, paid.settledOut) : 10_000n;
    rawShort.push(rs);
    firmShort.push(fs);
    rawLost.push(bestQuote > raw.out ? bestQuote - raw.out : 0n);
    firmLost.push(paid && paid.quotedOut > firm.out ? paid.quotedOut - firm.out : 0n);
    rows.push([i + 1, tokens.toString(), `${bestName} ${tok(bestQuote)}`, tok(raw.out), rs.toString(), tok(firm.out), fs.toString(), firm.leg]);
  }

  return {
    ...base,
    tables: [
      {
        caption: "Aggregate",
        table: {
          headers: ["Metric", "Unprotected agent (RawRouter)", "Protected agent (FirmRouter)"],
          rows: [
            ["Total loss vs quote (tUSDC)", tok(sum(rawLost)), tok(sum(firmLost))],
            ["Mean shortfall", bps(mean(rawShort)), bps(mean(firmShort))],
            ["Trades filled", `${cfg.trials}/${cfg.trials}`, `${firmFilled}/${cfg.trials}`],
          ],
        },
      },
      {
        caption: "Per trade",
        table: { headers: ["#", "tUSD in", "Best quote pick", "Raw received", "Raw shortfall bps", "FIRM received", "FIRM shortfall bps", "FIRM leg"], rows },
      },
    ],
    notes: [
      "The raw agent picks route 0 from quote-api. On the seeded pools that is the quote-only fixture (best off-chain quote because simulations see a zero fee), whose real-transaction fee differs from its simulated one; FirmRouter skips it with LegSkipped reason 4 (advertisedOut mismatch), then rejects the context hook and fills the honest pool.",
      "This is a scripted trader, not an LLM agent: the LLM variant (spec M6, P2) is not part of this build.",
    ],
  };
};
