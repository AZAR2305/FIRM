import raw from "@/generated/evidence.json";

/** One decoded event of a real transaction (built by scripts/build-evidence.mjs from the receipt, not typed in). */
export interface EvidenceEvent {
  name: string;
  pool?: string;
  hook?: string;
  amountIn?: string;
  amountOut?: string;
  quotedOut?: string;
  settledOut?: string;
  shortfallBps?: string;
  execFailed?: boolean;
  reason?: string | number;
  legIndex?: number | string;
  oldStatus?: number | string;
  newStatus?: number | string;
}

export interface EvidenceTx {
  label: string;
  title: string;
  hash: string;
  block: number;
  timestamp: number;
  status: string;
  gasLimit: string;
  events: EvidenceEvent[];
}

export interface PoolGas {
  status?: string;
  raw: number | { error: string };
  protected: number | { error: string } | null;
  protectedNote?: string;
}

export interface FirstTouch {
  date: string;
  state: string;
  method: string;
  pools: Record<string, { raw: number; protected: number }>;
  quotePerCall: Record<string, number>;
  demoShape: number;
  hostileFirst: number;
}

export interface Evidence {
  generatedAt: string;
  source: "testnet" | "fork";
  chain: { head: number; gasPriceWei: string; gasPriceGwei: number };
  txs: EvidenceTx[];
  gas: {
    method: string;
    pools: Record<string, PoolGas>;
    quotePerCall: Record<string, number | { error: string }>;
    demoShape: { note: string; protected: number | null; protectedNote?: string };
    hostileFirst: { note: string; protected: number | { error: string } };
  };
  recorded: {
    deployment: Record<string, string | number>;
    envioCheck: { date: string; command: string; result: string; mode: string };
    firstTouch: FirstTouch;
    notRun: string;
  };
}

/** null when scripts/build-evidence.mjs has not been run for this deployment. */
export const evidence: Evidence | null = (raw as { available?: boolean }).available === false ? null : (raw as unknown as Evidence);

export const evidenceMissingReason: string = (raw as { reason?: string }).reason ?? "no evidence file";

/** Gas limit x gas price in MON: what Monad charges (the limit, not the gas used). Exact integer math to 4 decimals, rounded up so a cost is never understated. */
export function costMon(gasLimit: number, gasPriceWei: bigint | string | number): string {
  const wei = BigInt(gasLimit) * BigInt(gasPriceWei);
  const unit = 10n ** 14n;
  const scaled = (wei + unit - 1n) / unit; // ceil to 0.0001 MON
  return `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, "0")}`;
}

export const num = (v: number | { error: string } | null | undefined): number | null => (typeof v === "number" ? v : null);

/** protected / raw, to two decimals, or null if either is missing */
export function overhead(raw: number | null, prot: number | null): string | null {
  return raw && prot ? (prot / raw).toFixed(2) : null;
}

export interface Headline {
  amountIn: bigint;
  rawOut: bigint;
  firmOut: bigint;
  saved: bigint;
  rejectedPool: string;
  quoted: bigint;
  delivered: bigint;
  shortfallBps: number;
  filledPool: string;
  rawTx: EvidenceTx;
  firmTx: EvidenceTx;
}

/** The headline numbers, computed from the decoded events of the two real transactions (never typed). null if the evidence does not contain both. */
export function headline(ev: Evidence | null): Headline | null {
  if (!ev) return null;
  const rawTx = ev.txs.find((t) => t.label === "raw");
  const firmTx = ev.txs.find((t) => t.label === "firm");
  const raw = rawTx?.events.find((e) => e.name === "RawSwap");
  const rej = firmTx?.events.find((e) => e.name === "Rejected");
  const fill = firmTx?.events.find((e) => e.name === "Filled");
  if (!rawTx || !firmTx || !raw?.amountOut || !raw.amountIn || !rej?.quotedOut || !rej.settledOut || !fill?.settledOut) return null;
  const rawOut = BigInt(raw.amountOut);
  const firmOut = BigInt(fill.settledOut);
  const q = BigInt(rej.quotedOut);
  const s = BigInt(rej.settledOut);
  return {
    amountIn: BigInt(raw.amountIn),
    rawOut,
    firmOut,
    saved: firmOut - rawOut,
    rejectedPool: rej.pool ?? "?",
    quoted: q,
    delivered: s,
    shortfallBps: Number(((q - s) * 10_000n) / q),
    filledPool: fill.pool ?? "?",
    rawTx,
    firmTx,
  };
}
