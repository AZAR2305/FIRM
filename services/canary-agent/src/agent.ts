import type { Address } from "viem";
import { decodeHookFlags, canChangeSwapAmounts, type HookStatsT, type Logger, type RouteT } from "@firm/shared";
import type { PoolRecord } from "./discover";
import type { ProbeExecutor } from "./prober";
import { analyzeBytecode } from "./staticAnalysis";
import { buildGrid, saveReport, templateReport, type Evidence } from "./report";
import type { Store } from "./store";
import { llmSummary, type LlmConfig } from "./llm";

const E18 = 10n ** 18n;

export interface AgentOptions {
  /** dust sizes in whole tokens: spec matrix {1, 10, 100} */
  amounts: bigint[];
  /** ProbeSender identities: spec matrix {0..3} */
  senders: number[];
  /** seconds between re-probe rounds (spec: every few hours) */
  reprobeIntervalSec: number;
  /** stop probing a pool as soon as its hook is BLOCKED (saves gas); set false to collect the full grid */
  stopOnBlocked: boolean;
  reportsDir: string;
  /** pause between probes so they spread over several blocks */
  probeDelayMs: number;
}

export const defaultOptions = (reportsDir: string): AgentOptions => ({
  amounts: [1n * E18, 10n * E18, 100n * E18],
  senders: [0, 1, 2, 3],
  reprobeIntervalSec: 6 * 3600,
  stopOnBlocked: true,
  reportsDir,
  probeDelayMs: 0,
});

export interface HookInfo {
  stats: HookStatsT;
  bytecode: `0x${string}`;
}

export interface AgentDeps {
  exec: ProbeExecutor;
  hookInfo(hook: Address): Promise<HookInfo>;
  store: Store;
  log: Logger;
  llm?: LlmConfig | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The probe matrix for one pool: amounts x senders x both directions (24 probes with the defaults). */
export function probeMatrix(opts: Pick<AgentOptions, "amounts" | "senders">) {
  const cells: { zeroForOne: boolean; amountIn: bigint; senderIdx: number }[] = [];
  for (const zeroForOne of [true, false])
    for (const amountIn of opts.amounts) for (const senderIdx of opts.senders) cells.push({ zeroForOne, amountIn, senderIdx });
  return cells;
}

/**
 * canary-agent core. Deterministic logic only: it decides *what to probe*, the CanaryRunner contract produces the
 * evidence and the Scoreboard contract decides status. The LLM (optional) only writes the prose summary.
 */
export class CanaryAgent {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly deps: AgentDeps,
    private readonly opts: AgentOptions,
  ) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Probe every pool whose current round is incomplete, or whose re-probe interval has elapsed. */
  async runOnce(pools: PoolRecord[]): Promise<{ probesSent: number; reports: string[] }> {
    let sent = 0;
    const reports: string[] = [];
    for (const pool of pools) {
      const { store, log } = this.deps;
      let round = store.currentRound(pool.poolId);

      // a finished round older than the interval starts a new one (catches hooks that change behaviour later)
      const last = store.lastRoundAt(pool.poolId);
      if (last !== undefined && this.now() - last >= this.opts.reprobeIntervalSec && this.pendingFor(pool, round).length === 0) {
        store.startNextRound(pool.poolId);
        round = store.currentRound(pool.poolId);
        log.info("starting re-probe round", { pool: pool.poolId, round });
      }

      const pending = this.pendingFor(pool, round);
      if (pending.length > 0) {
        await this.deps.exec.ensureFunding([pool.key.currency0, pool.key.currency1], this.opts.amounts.reduce((a, b) => (a > b ? a : b), 0n));
        for (const cell of pending) {
          if (this.opts.stopOnBlocked && (await this.deps.hookInfo(pool.key.hooks)).stats.status === "BLOCKED") {
            log.info("hook already BLOCKED, stopping probes for this pool", { hook: pool.key.hooks });
            break;
          }
          const route: RouteT = { key: pool.key, zeroForOne: cell.zeroForOne, hookData: "0x", advertisedOut: 0n };
          const r = await this.deps.exec.probe(route, cell.amountIn, cell.senderIdx);
          store.addProbe({
            poolId: pool.poolId,
            hook: pool.key.hooks,
            zeroForOne: cell.zeroForOne,
            amountIn: cell.amountIn.toString(),
            senderIdx: cell.senderIdx,
            probeSender: r.probeSender,
            quotedOut: r.quotedOut.toString(),
            settledOut: r.settledOut.toString(),
            shortfallBps: r.shortfallBps.toString(),
            txHash: r.txHash,
            blockNumber: r.blockNumber.toString(),
            ts: this.now(),
            round,
          });
          sent++;
          if (this.opts.probeDelayMs > 0) await this.sleep(this.opts.probeDelayMs);
        }
        store.completeRound(pool.poolId, this.now());
      }

      // one report per hook, refreshed whenever we probed it
      if (pending.length > 0) reports.push(await this.report(pool.key.hooks));
    }
    return { probesSent: sent, reports };
  }

  private pendingFor(pool: PoolRecord, round: number) {
    return probeMatrix(this.opts).filter(
      (c) => !this.deps.store.hasProbe(pool.poolId, c.zeroForOne, c.amountIn, c.senderIdx, round),
    );
  }

  /** Build, and save, the report for a hook. */
  async report(hook: Address): Promise<string> {
    const info = await this.deps.hookInfo(hook);
    const analysis = analyzeBytecode(info.bytecode);
    const evidence: Evidence = {
      hook,
      generatedAt: new Date(this.now() * 1000).toISOString(),
      status: info.stats.status,
      flags: decodeHookFlags(hook),
      canChangeSwapAmounts: canChangeSwapAmounts(hook),
      riskFlags: analysis.riskFlags,
      stats: {
        fills: info.stats.fills,
        strikes: info.stats.strikes,
        probes: info.stats.probes,
        probeStrikes: info.stats.probeStrikes,
        cleanProbes: info.stats.cleanProbes,
        cleanProbeSenders: info.stats.cleanProbeSenders,
      },
      probeGrid: buildGrid(this.deps.store.probesFor(hook)),
    };
    let markdown = templateReport(evidence);
    if (this.deps.llm) {
      const prose = await llmSummary(this.deps.llm, evidence);
      if (prose) markdown += `\n\n## Summary (AI-written, advisory)\n\n${prose}`;
    }
    saveReport(this.opts.reportsDir, hook, markdown, evidence);
    return markdown;
  }
}
