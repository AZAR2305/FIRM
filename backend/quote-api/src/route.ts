import type { Address, Hex } from "viem";
import { floorOf, type PoolKeyT, type RouteT, type StatusName } from "@firm/shared";
import type { ChainReader } from "./chainReader";
import type { PoolInfo, PoolSource } from "./pools";

/** The contract's MAX_LEGS. */
export const MAX_LEGS = 4;
const ZERO = "0x0000000000000000000000000000000000000000";

export interface RouteRequest {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  maxLegs?: number;
}

export interface RouteView {
  poolId: Hex;
  description?: string;
  key: PoolKeyT;
  zeroForOne: boolean;
  hookData: Hex;
  /** In-transaction-comparable quote from the Quoter via eth_call; also passed on as the route's advertisedOut. */
  quotedOut: bigint;
  advertisedOut: bigint;
  status: StatusName;
  toleranceBps: number;
  /** quotedOut * (10000 - tolerance) / 10000: what FirmRouter would enforce if the quote were unchanged */
  floor: bigint;
}

export interface SkippedView {
  poolId: Hex;
  hook: Address;
  reason: "NO_LIQUIDITY" | "BLOCKED" | "UNRATED_CAP" | "QUOTE_FAILED";
}

export interface RouteResult {
  routes: RouteView[];
  skipped: SkippedView[];
  /** The router's calldata form of `routes` (ready for FirmRouter.swapExactIn). */
  calldataRoutes: RouteT[];
}

/**
 * Spec 10.2. quote-api only *orders* candidates; it is never trusted for safety because FirmRouter re-quotes and
 * re-checks everything onchain.
 */
export async function computeRoutes(chain: ChainReader, source: PoolSource, req: RouteRequest): Promise<RouteResult> {
  const maxLegs = Math.min(req.maxLegs ?? MAX_LEGS, MAX_LEGS);
  const pools = await source.poolsForPair(req.tokenIn, req.tokenOut);
  const skipped: SkippedView[] = [];

  // 1) drop pools with no liquidity
  const liq = await chain.liquidity(pools.map((p) => p.poolId));
  const live: PoolInfo[] = [];
  for (const p of pools) {
    if ((liq.get(p.poolId.toLowerCase()) ?? 0n) > 0n) live.push(p);
    else skipped.push({ poolId: p.poolId, hook: p.key.hooks, reason: "NO_LIQUIDITY" });
  }

  // 2) hook status in one batch; drop BLOCKED, and UNRATED above the cap
  const hooks = live.map((p) => p.key.hooks);
  const [statuses, tolerances, cap] = await Promise.all([chain.statuses(hooks), chain.tolerances(hooks), chain.unratedCap()]);
  const eligible: { pool: PoolInfo; status: StatusName; tol: number }[] = [];
  for (const pool of live) {
    const h = pool.key.hooks.toLowerCase();
    const status = h === ZERO ? "NORMAL" : (statuses.get(h) ?? "UNRATED");
    if (status === "BLOCKED") {
      skipped.push({ poolId: pool.poolId, hook: pool.key.hooks, reason: "BLOCKED" });
      continue;
    }
    if (status === "UNRATED" && req.amountIn > cap) {
      skipped.push({ poolId: pool.poolId, hook: pool.key.hooks, reason: "UNRATED_CAP" });
      continue;
    }
    eligible.push({ pool, status, tol: tolerances.get(h) ?? 10 });
  }

  // 3) batch Quoter calls; discard failures
  const zeroFor = (p: PoolInfo) => p.key.currency0.toLowerCase() === req.tokenIn.toLowerCase();
  const quotes = await chain.quotes(
    eligible.map((e) => ({ key: e.pool.key, zeroForOne: zeroFor(e.pool), amountIn: req.amountIn, hookData: "0x" as Hex })),
  );

  const views: RouteView[] = [];
  eligible.forEach((e, i) => {
    const q = quotes[i];
    if (q == null || q === 0n) {
      skipped.push({ poolId: e.pool.poolId, hook: e.pool.key.hooks, reason: "QUOTE_FAILED" });
      return;
    }
    views.push({
      poolId: e.pool.poolId,
      description: e.pool.description,
      key: e.pool.key,
      zeroForOne: zeroFor(e.pool),
      hookData: "0x",
      quotedOut: q,
      advertisedOut: q,
      status: e.status,
      toleranceBps: e.tol,
      floor: floorOf(q, e.tol),
    });
  });

  // 4) best quote first, top maxLegs. Ties keep a stable order by pool id.
  views.sort((a, b) => (a.quotedOut === b.quotedOut ? (a.poolId < b.poolId ? -1 : 1) : a.quotedOut > b.quotedOut ? -1 : 1));
  const routes = views.slice(0, maxLegs);

  return {
    routes,
    skipped,
    calldataRoutes: routes.map((r) => ({
      key: r.key,
      zeroForOne: r.zeroForOne,
      hookData: r.hookData,
      advertisedOut: r.advertisedOut,
    })),
  };
}
