import type { Ctx } from "../ctx";
import type { ExperimentResult } from "../stats";

export interface BenchConfig {
  /** swaps per hook / per arm (spec: 20) */
  trials: number;
  /** minimum honest probes + fills for B2 (spec: 50) */
  honestExecutions: number;
  /** the headline trade size in tokens (spec: 1,000) */
  tradeTokens: bigint;
  quoteApiUrl?: string;
  envioUrl?: string;
}

export type Experiment = (ctx: Ctx, cfg: BenchConfig) => Promise<ExperimentResult>;

/** The 12-probe matrix of spec B1: 3 amounts x 4 sender identities. */
export const PROBE_AMOUNTS = [1n, 10n, 100n].map((n) => n * 10n ** 18n);
export const PROBE_SENDERS = [0, 1, 2, 3];
