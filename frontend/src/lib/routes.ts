import type { Address, Hex } from "viem";
import { floorOf } from "./format";
import type { StatusName } from "./status";

/** The contract's MAX_LEGS. */
export const MAX_LEGS = 4;
const ZERO = "0x0000000000000000000000000000000000000000";

export interface PoolKeyT {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** Mirrors the Solidity Route struct passed to FirmRouter.swapExactIn / RawRouter.swapExactInRaw. */
export interface RouteT {
  key: PoolKeyT;
  zeroForOne: boolean;
  hookData: Hex;
  advertisedOut: bigint;
}

export interface Candidate {
  name: string;
  description: string;
  poolId: Hex;
  key: PoolKeyT;
  status: StatusName;
  toleranceBps: number;
  /** null when the Quoter reverted */
  quotedOut: bigint | null;
}

export interface RouteRow {
  name: string;
  description: string;
  poolId: Hex;
  key: PoolKeyT;
  hook: Address;
  status: StatusName;
  quotedOut: bigint;
  floor: bigint;
  toleranceBps: number;
}

export interface SkippedRow {
  name: string;
  description: string;
  poolId: Hex;
  hook: Address;
  reason: "BLOCKED" | "UNRATED_CAP" | "QUOTE_FAILED" | "NOT_IN_TOP_LEGS";
}

export interface RoutePlan {
  routes: RouteRow[];
  skipped: SkippedRow[];
}

/**
 * Same ordering rules as quote-api (spec 10.2), so the preview matches what the service would send: drop BLOCKED hooks, drop
 * UNRATED hooks when the trade is above the UNRATED cap, drop failed quotes, best quote first, at most `maxLegs`. This only
 * ORDERS candidates; FirmRouter re-quotes and re-checks everything on-chain, so nothing here is trusted for safety.
 */
export function planRoute(candidates: Candidate[], amountIn: bigint, unratedCap: bigint, maxLegs = MAX_LEGS): RoutePlan {
  const skipped: SkippedRow[] = [];
  const live: RouteRow[] = [];
  for (const c of candidates) {
    const base = { name: c.name, description: c.description, poolId: c.poolId, hook: c.key.hooks };
    if (c.status === "BLOCKED") {
      skipped.push({ ...base, reason: "BLOCKED" });
      continue;
    }
    if (c.status === "UNRATED" && c.key.hooks.toLowerCase() !== ZERO && amountIn > unratedCap) {
      skipped.push({ ...base, reason: "UNRATED_CAP" });
      continue;
    }
    if (c.quotedOut == null || c.quotedOut === 0n) {
      skipped.push({ ...base, reason: "QUOTE_FAILED" });
      continue;
    }
    live.push({
      ...base,
      key: c.key,
      status: c.status,
      quotedOut: c.quotedOut,
      toleranceBps: c.toleranceBps,
      floor: floorOf(c.quotedOut, c.toleranceBps),
    });
  }
  live.sort((a, b) => (a.quotedOut === b.quotedOut ? (a.poolId < b.poolId ? -1 : 1) : a.quotedOut > b.quotedOut ? -1 : 1));
  const routes = live.slice(0, maxLegs);
  for (const r of live.slice(maxLegs)) skipped.push({ name: r.name, description: r.description, poolId: r.poolId, hook: r.hook, reason: "NOT_IN_TOP_LEGS" });
  return { routes, skipped };
}

/** The calldata form of a planned route. `advertisedOut` is the off-chain quote, which FirmRouter compares with its in-tx quote. */
export function toCalldataRoutes(rows: RouteRow[], zeroForOne: boolean): RouteT[] {
  return rows.map((r) => ({ key: r.key, zeroForOne, hookData: "0x", advertisedOut: r.quotedOut }));
}
