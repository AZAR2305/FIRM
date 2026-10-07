import type { Deployments } from "@firm/shared";
import { mdTable, type ExperimentResult } from "./stats";

export interface RunInfo {
  generatedAt: string;
  commit: string;
  chainId: number;
  headBlockStart: bigint;
  headBlockEnd: bigint;
  /** true when the RPC is a local anvil/fork: results are NOT testnet measurements */
  localFork: boolean;
  trials: number;
  txCount: number;
  durationSec: number;
  wallet: string;
}

const FORMULAS = `shortfall_bps          = max(0, quoted - settled) * 10000 / quoted
loss_vs_quote_bps      = shortfall_bps of the leg that actually paid the user
loss_vs_best_honest    = (best honest quote - received) / best honest quote * 10000
catch_rate             = strikes_recorded / deviating_executions_attempted
false_positive_rate    = strikes_on_honest_hook / total_honest_executions`;

export function renderResults(dep: Deployments, run: RunInfo, results: ExperimentResult[]): string {
  const env = run.localFork
    ? `> **LOCAL FORK RUN. These are NOT Monad Testnet measurements.** The RPC was a local anvil fork of testnet state: contract behaviour is real (the deployed PoolManager and V4Quoter), but gas follows Ethereum rules, not Monad's repriced schedule, and block/timing numbers are meaningless. The testnet run replaces this file (\`pnpm bench\`).`
    : `> Run against Monad Testnet (chain ${run.chainId}).`;

  const out: string[] = [
    `# FIRM benchmark results`,
    ``,
    env,
    ``,
    `| | |`,
    `|---|---|`,
    `| Generated | ${run.generatedAt} |`,
    `| Commit | \`${run.commit}\` |`,
    `| Chain id | ${run.chainId} |`,
    `| Blocks | ${run.headBlockStart} to ${run.headBlockEnd} |`,
    `| Trials per arm | ${run.trials} |`,
    `| Transactions sent | ${run.txCount} |`,
    `| Duration | ${run.durationSec.toFixed(0)} s |`,
    `| Bench wallet (deployer / owner) | \`${run.wallet}\` |`,
    `| Scoreboard | \`${dep.core.scoreboard.address}\` |`,
    `| FirmRouter | \`${dep.core.firmRouter.address}\` |`,
    `| RawRouter (unprotected comparator) | \`${dep.core.rawRouter.address}\` |`,
    `| CanaryRunner | \`${dep.core.canaryRunner.address}\` |`,
    ``,
    `## What this does and does not show`,
    ``,
    `- The hooks under test are **our own quarantined fixtures** (\`contracts/test-fixtures\`). Catching them shows the mechanism works; it does not show that real malicious hooks in the field are caught.`,
    `- Between trials the bench owner **reinstates** a BLOCKED hook so each trial is a first encounter. In steady state a blocked hook is skipped, not retried.`,
    `- Numbers are reported as measured, including unfavourable ones. Nothing is rounded in our favour.`,
    ``,
    `## Formulas`,
    ``,
    "```",
    FORMULAS,
    "```",
    ``,
  ];

  for (const r of results) {
    out.push(`## ${r.id}. ${r.title}`, ``);
    if (r.skipped) {
      out.push(`_Skipped: ${r.skipped}_`, ``);
      continue;
    }
    out.push(`**Method.** ${r.method}`, ``);
    for (const t of r.tables) {
      if (t.caption) out.push(`**${t.caption}**`, ``);
      out.push(mdTable(t.table), ``);
    }
    if (r.notes.length) {
      out.push(`**Notes**`, ``);
      for (const n of r.notes) out.push(`- ${n}`);
      out.push(``);
    }
  }
  return out.join("\n");
}
