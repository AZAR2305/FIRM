import { formatUnits, parseUnits } from "viem";

export const DECIMALS = 18;
export const BPS = 10_000n;

/** shortfall_bps = max(0, quoted - settled) * 10_000 / quoted; a zero quote counts as 100% (mirrors RouteLib). */
export function shortfallBps(quoted: bigint, settled: bigint): bigint {
  if (quoted === 0n) return BPS;
  if (settled >= quoted) return 0n;
  return ((quoted - settled) * BPS) / quoted;
}

/** floor = quoted * (10_000 - tolBps) / 10_000 (mirrors RouteLib) */
export function floorOf(quoted: bigint, tolBps: bigint | number): bigint {
  return (quoted * (BPS - BigInt(tolBps))) / BPS;
}

/** 18-decimal bigint to a fixed-decimals string, rounded to the nearest (half up), as the spec's examples are:
 *  998199652299447526702n -> "998.2" (dp 1), 819179181639997541642n -> "819.2". Exact integer math, no floats. */
export function fmt(v: bigint, dp = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const scale = 10n ** BigInt(18 - dp);
  const rounded = (a + scale / 2n) / scale;
  const base = 10n ** BigInt(dp);
  const whole = rounded / base;
  const frac = dp > 0 ? (rounded % base).toString().padStart(dp, "0") : "";
  const withCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg && rounded !== 0n ? "-" : ""}${withCommas}${dp > 0 ? "." + frac : ""}`;
}

export function pct(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(1)}%`;
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/** Parses a user-typed decimal amount. Returns null for empty, malformed, zero or negative input. */
export function parseAmount(text: string): bigint | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  try {
    const v = parseUnits(t, DECIMALS);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function formatToken(v: bigint, dp = 2): string {
  return fmt(v, dp);
}

export { formatUnits, parseUnits };

/** "3 min ago", "2 h ago", or "never" for 0. `nowSec` is injectable for tests. */
export function relativeTime(unixSec: bigint | number, nowSec = Math.floor(Date.now() / 1000)): string {
  const t = Number(unixSec);
  if (!t) return "never";
  const d = Math.max(0, nowSec - t);
  if (d < 5) return "just now";
  if (d < 60) return `${d} s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86_400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86_400)} d ago`;
}
