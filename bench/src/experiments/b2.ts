import { E18 } from "../ctx";
import type { ExperimentResult } from "../stats";
import { PROBE_AMOUNTS, PROBE_SENDERS, type Experiment } from "./types";

/** B2 False positives: FixtureHonestHook (pool C) under many probes and many protected fills. Target: 0 strikes, NORMAL. */
export const b2: Experiment = async (ctx, cfg): Promise<ExperimentResult> => {
  await ctx.fund(5000n * E18);
  const hook = ctx.hook("C");
  const before = await ctx.stats(hook);
  const startStatus = before.status;

  const half = Math.ceil(cfg.honestExecutions / 2);
  let probes = 0;
  for (let i = 0; i < half; i++) {
    const amt = PROBE_AMOUNTS[i % PROBE_AMOUNTS.length]!;
    const idx = PROBE_SENDERS[i % PROBE_SENDERS.length]!;
    // alternate directions: both are honest for this hook
    await ctx.probe("C", amt, idx, i % 2 === 0 ? ctx.zeroForOne : !ctx.zeroForOne);
    probes++;
  }
  let fills = 0;
  for (let i = 0; i < half; i++) {
    const r = await ctx.firmSwap([ctx.route("C")], (5n + BigInt(i % 10)) * E18);
    if (r.events.filled) fills++;
  }
  const after = await ctx.stats(hook);
  const total = probes + fills;
  const newStrikes = after.strikes - before.strikes;

  return {
    id: "B2",
    title: "False positives",
    method: `FixtureHonestHook (constant 13 bps fee on every path): ${probes} canary probes (both directions, 3 amounts, 4 sender identities) plus ${fills} FirmRouter fills.`,
    tables: [
      {
        table: {
          headers: ["Honest executions", "Strikes (target 0)", "False-positive rate", "Start status", "Final status (target NORMAL)", "Clean probes", "Distinct clean senders"],
          rows: [[total, newStrikes, `${((newStrikes / total) * 100).toFixed(2)}%`, startStatus, after.status, after.cleanProbes, after.cleanProbeSenders]],
        },
      },
    ],
    notes: [
      "false_positive_rate = strikes on honest hook / total honest executions.",
      "The honest hook charges the same disclosed fee on the quote and real paths, so quote == settled exactly; the 10 bps tolerance is never needed.",
      "Honest hooks with legitimate caller-specific discounts could look suspicious and land in WATCH (not tested here).",
    ],
  };
};
