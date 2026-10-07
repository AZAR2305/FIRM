/** Basis-point math: a bit-for-bit mirror of the Solidity RouteLib (denominator 10_000, rounding down). */
export const BPS = 10_000n;

/** shortfall_bps = max(0, quoted - settled) * 10_000 / quoted. A zero quote counts as 100%. */
export function shortfallBps(quoted: bigint, settled: bigint): bigint {
  if (quoted === 0n) return BPS;
  if (settled >= quoted) return 0n;
  return ((quoted - settled) * BPS) / quoted;
}

/** floor = quoted * (10_000 - tolBps) / 10_000 */
export function floorOf(quoted: bigint, tolBps: bigint | number): bigint {
  return (quoted * (BPS - BigInt(tolBps))) / BPS;
}

/** (best honest quote - received) / best honest quote * 10_000 */
export function lossVsBestHonestBps(bestHonestQuote: bigint, received: bigint): bigint {
  if (bestHonestQuote === 0n) return 0n;
  if (received >= bestHonestQuote) return 0n;
  return ((bestHonestQuote - received) * BPS) / bestHonestQuote;
}

/** 18-decimal bigint to a short decimal string, e.g. 998199652299447526702n -> "998.1996" */
export function fmt18(v: bigint, dp = 4): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 10n ** 18n;
  const frac = (a % 10n ** 18n).toString().padStart(18, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole}${dp > 0 ? "." + frac : ""}`;
}
