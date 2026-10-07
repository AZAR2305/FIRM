import { fmt18 } from "@firm/shared";

/** Percentile by nearest-rank on a copy of the data. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length, Math.max(1, rank)) - 1]!;
}

export const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
export const mean = (xs: bigint[]) => (xs.length ? sum(xs) / BigInt(xs.length) : 0n);

/** a / b as a percentage string with 1 decimal ("n/a" when b = 0) */
export function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
}

/** bps with two decimals from bigint bps */
export const bps = (v: bigint) => `${v.toString()} bps (${(Number(v) / 100).toFixed(2)}%)`;

export const tok = (v: bigint) => fmt18(v, 4);

export interface Table {
  headers: string[];
  rows: (string | number)[][];
}

export interface ExperimentResult {
  id: string;
  title: string;
  method: string;
  /** one or more result tables */
  tables: { caption?: string; table: Table }[];
  /** plain statements of what the numbers do and do not show */
  notes: string[];
  /** set when the experiment could not run */
  skipped?: string;
}

export function mdTable(t: Table): string {
  const esc = (c: string | number) => String(c).replace(/\|/g, "\\|");
  return [
    `| ${t.headers.map(esc).join(" | ")} |`,
    `|${t.headers.map(() => "---").join("|")}|`,
    ...t.rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}
