import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { getAddress, isAddress, type Address } from "viem";
import {
  decodeHookFlags,
  canChangeSwapAmounts,
  readHookStats,
  type Deployments,
  type Logger,
  type StatusName,
  STATUS_NAMES,
} from "@firm/shared";
import type { PublicClient } from "viem";
import type { ChainReader } from "./chainReader";
import type { PoolSource } from "./pools";
import { computeRoutes } from "./route";
import { TtlCache } from "./cache";
import type { ReportReader } from "./reports";

export interface AppDeps {
  chain: ChainReader;
  source: PoolSource;
  dep: Deployments;
  log: Logger;
  reports: ReportReader;
  /** only needed for /hooks (reads Scoreboard stats) */
  client: PublicClient;
  cacheMs?: number;
  corsOrigin?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 500 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON with bigint as decimal strings (amounts are 18-decimal, they do not fit a JS number). */
function ser(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ser(x)]));
  return v;
}

const addressSchema = z
  .string()
  .refine((s) => isAddress(s, { strict: false }), "invalid address")
  .transform((s) => getAddress(s.toLowerCase()) as Address);

const amountSchema = z
  .string()
  .regex(/^\d+$/, "amountIn must be a decimal integer string in token base units")
  .transform((s) => BigInt(s))
  .refine((n) => n > 0n && n < 2n ** 128n, "amountIn must be in (0, 2^128)");

const routeBody = z.object({
  tokenIn: addressSchema,
  tokenOut: addressSchema,
  amountIn: amountSchema,
  maxLegs: z.number().int().min(1).max(4).optional(),
  wallet: addressSchema.optional(),
});

const pairQuery = z.object({ tokenIn: addressSchema, tokenOut: addressSchema });

export function createApp(deps: AppDeps) {
  const { chain, source, dep, log, reports, client } = deps;
  const cache = new TtlCache(deps.cacheMs ?? 1500);
  const app = new Hono();
  app.use("*", cors({ origin: deps.corsOrigin ?? "*" }));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof z.ZodError) {
      return c.json({ error: { code: "BAD_REQUEST", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, 400);
    }
    log.error("unhandled", { err: err.message });
    return c.json({ error: { code: "INTERNAL", message: "internal error" } }, 500);
  });

  app.get("/health", async (c) => {
    const blockNumber = await chain.blockNumber();
    return c.json(ser({ ok: true, chainId: dep.chainId, blockNumber, rpcInUse: chain.rpcInUse() ?? null, poolSource: source.lastUsed?.() ?? null }));
  });

  app.get("/pools", async (c) => {
    const { tokenIn, tokenOut } = pairQuery.parse(c.req.query());
    const out = await cache.getOrSet(`pools:${tokenIn}:${tokenOut}`, async () => {
      const pools = await source.poolsForPair(tokenIn, tokenOut);
      const [liq, st] = await Promise.all([chain.liquidity(pools.map((p) => p.poolId)), chain.statuses(pools.map((p) => p.key.hooks))]);
      return pools.map((p) => ({
        poolId: p.poolId,
        description: p.description,
        key: p.key,
        liquidity: liq.get(p.poolId.toLowerCase()) ?? 0n,
        status: st.get(p.key.hooks.toLowerCase()) ?? "UNRATED",
      }));
    });
    return c.json(ser({ pools: out }));
  });

  app.post("/route", async (c) => {
    const body = routeBody.parse(await c.req.json().catch(() => {
      throw new HttpError(400, "BAD_REQUEST", "body must be JSON");
    }));
    if (body.tokenIn.toLowerCase() === body.tokenOut.toLowerCase()) {
      throw new HttpError(400, "BAD_REQUEST", "tokenIn and tokenOut must differ");
    }
    const key = `route:${body.tokenIn}:${body.tokenOut}:${body.amountIn}:${body.maxLegs ?? 4}`;
    const result = await cache.getOrSet(key, () =>
      computeRoutes(chain, source, { tokenIn: body.tokenIn, tokenOut: body.tokenOut, amountIn: body.amountIn, maxLegs: body.maxLegs }),
    );

    // Protected-versus-Raw preview (spec 10.2 step 5): the naive pick is the first (best-quote) route.
    let preview = null;
    if (body.wallet && result.routes.length > 0) {
      preview = await chain.preview(body.wallet, result.calldataRoutes, body.tokenIn, body.amountIn);
    }
    return c.json(
      ser({
        routes: result.routes,
        skipped: result.skipped,
        naivePick: result.routes[0]?.poolId ?? null,
        preview,
        // exactly what to pass to FirmRouter.swapExactIn(routes, amountIn, minTotalOut, recipient, deadline)
        calldataRoutes: result.calldataRoutes,
      }),
    );
  });

  const hookView = async (hook: Address) => {
    const stats = await readHookStats(client, dep.core.scoreboard.address, hook);
    return {
      hook,
      status: stats.status,
      fills: stats.fills,
      strikes: stats.strikes,
      probes: stats.probes,
      probeStrikes: stats.probeStrikes,
      avgShortfallBps: stats.strikes > 0 ? stats.cumShortfallBps / BigInt(stats.strikes) : 0n,
      lastStrikeAt: stats.lastStrikeAt === 0n ? null : stats.lastStrikeAt,
      flags: decodeHookFlags(hook),
      canChangeSwapAmounts: canChangeSwapAmounts(hook),
    };
  };

  app.get("/hooks", async (c) => {
    const filter = z.enum(STATUS_NAMES).optional().parse(c.req.query("status")?.toUpperCase());
    const list = await cache.getOrSet("hooks", async () => {
      const hooks = await source.allHooks();
      return Promise.all(hooks.map((h) => hookView(getAddress(h))));
    });
    const sorted = list
      .filter((h) => !filter || h.status === (filter as StatusName))
      // worst first: BLOCKED, WATCH, UNRATED, NORMAL; then most strikes
      .sort((a, b) => STATUS_NAMES.indexOf(b.status) - STATUS_NAMES.indexOf(a.status) || b.strikes - a.strikes);
    return c.json(ser({ hooks: sorted }));
  });

  app.get("/hooks/:addr", async (c) => {
    const hook = addressSchema.parse(c.req.param("addr"));
    const [view, report] = await Promise.all([hookView(hook), reports(hook)]);
    return c.json(ser({ ...view, report: report ? { createdAt: report.createdAt, evidence: report.evidence } : null }));
  });

  app.get("/hooks/:addr/report", async (c) => {
    const hook = addressSchema.parse(c.req.param("addr"));
    const report = await reports(hook);
    if (!report) throw new HttpError(404, "NOT_FOUND", "no report for this hook yet");
    return c.json(ser(report));
  });

  return app;
}
