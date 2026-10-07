import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fmt18, type HookStatsT } from "@firm/shared";
import type { Address } from "viem";
import type { ProbeRecord } from "./store";

/** Structured evidence a report is based on. Everything here is computed deterministically. */
export interface Evidence {
  hook: Address;
  generatedAt: string;
  status: string;
  flags: string[];
  canChangeSwapAmounts: boolean;
  /** context-sensitive opcodes found in the bytecode: prioritisation only, never a status input */
  riskFlags: string[];
  stats: Pick<HookStatsT, "fills" | "strikes" | "probes" | "probeStrikes" | "cleanProbes" | "cleanProbeSenders">;
  probeGrid: GridCell[];
}

/** One cell of the sender x amount grid the UI renders (spec 11.1). */
export interface GridCell {
  zeroForOne: boolean;
  amountIn: string;
  senderIdx: number;
  quotedOut: string;
  settledOut: string;
  shortfallBps: string;
  txHash: string;
}

export function buildGrid(probes: ProbeRecord[]): GridCell[] {
  return probes
    .map((p) => ({
      zeroForOne: p.zeroForOne,
      amountIn: p.amountIn,
      senderIdx: p.senderIdx,
      quotedOut: p.quotedOut,
      settledOut: p.settledOut,
      shortfallBps: p.shortfallBps,
      txHash: p.txHash,
    }))
    .sort((a, b) => Number(b.zeroForOne) - Number(a.zeroForOne) || a.senderIdx - b.senderIdx || Number(BigInt(a.amountIn) - BigInt(b.amountIn)));
}

/** Deterministic report. Always available, never depends on an LLM. */
export function templateReport(e: Evidence): string {
  const worst = e.probeGrid.reduce((m, c) => (BigInt(c.shortfallBps) > m ? BigInt(c.shortfallBps) : m), 0n);
  const offenders = [...new Set(e.probeGrid.filter((c) => BigInt(c.shortfallBps) > 10n).map((c) => c.senderIdx))].sort();
  const lines = [
    `# Hook ${e.hook}`,
    ``,
    `**Status: ${e.status}.** ${e.stats.fills} routed fills, ${e.stats.strikes} strikes, ${e.stats.probes} canary probes (${e.stats.probeStrikes} struck).`,
    ``,
    `- Permission flags: ${e.flags.length ? e.flags.join(", ") : "none"}${e.canChangeSwapAmounts ? " (can change swap amounts)" : ""}.`,
    `- Context-sensitive opcodes in bytecode: ${e.riskFlags.length ? e.riskFlags.join(", ") : "none found"} (a prioritisation hint only, many honest hooks use these).`,
  ];
  if (e.probeGrid.length === 0) {
    lines.push(`- No probes recorded yet.`);
  } else if (worst === 0n) {
    lines.push(`- All ${e.probeGrid.length} probes settled at their quote (worst shortfall 0 bps).`);
  } else {
    lines.push(
      `- Worst probe shortfall: ${worst} bps (${(Number(worst) / 100).toFixed(2)}%). Shortfalls above 10 bps came from sender identities: ${offenders.length ? offenders.join(", ") : "none"}.`,
    );
    const w = e.probeGrid.find((c) => BigInt(c.shortfallBps) === worst)!;
    lines.push(`- Example: quoted ${fmt18(BigInt(w.quotedOut))}, delivered ${fmt18(BigInt(w.settledOut))} for ${fmt18(BigInt(w.amountIn), 0)} in.`);
  }
  lines.push(``, `_Evidence computed onchain by CanaryRunner. This summary is advisory; status is decided by the Scoreboard contract._`);
  return lines.join("\n");
}

/** LLM text is untrusted: strip tags and control characters, cap the length. It is shown, never parsed or executed. */
export function sanitizeLlmText(text: string, maxChars = 1500): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x09\x0a\x20-\x7e -￿]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

export interface SavedReport {
  hook: string;
  createdAt: string;
  markdown: string;
  evidence: Evidence;
}

/** Writes <dir>/<hook>.json, the file quote-api serves at /hooks/:addr/report. */
export function saveReport(dir: string, hook: Address, markdown: string, evidence: Evidence): SavedReport {
  mkdirSync(dir, { recursive: true });
  const report: SavedReport = { hook, createdAt: new Date().toISOString(), markdown, evidence };
  writeFileSync(join(dir, `${hook.toLowerCase()}.json`), JSON.stringify(report, null, 2));
  return report;
}
