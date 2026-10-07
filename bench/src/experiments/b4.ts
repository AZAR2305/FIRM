import { E18 } from "../ctx";
import type { ExperimentResult } from "../stats";
import type { Experiment } from "./types";

/**
 * B4 Sender-aware hook. FixtureSenderAwareHook is honest to the Quoter and FirmRouter and takes a fee from everyone
 * else. Router-only protection never sees it; one canary probe from another sender identity does.
 */
export const b4: Experiment = async (ctx, cfg): Promise<ExperimentResult> => {
  const hook = ctx.hook("E");
  const dust = 10n * E18;
  await ctx.fund(2000n * E18);
  await ctx.reinstateIfBlocked(hook);
  const startStatus = await ctx.status(hook);
  const s0 = await ctx.stats(hook);

  // arm 1: router only
  let fills = 0;
  for (let i = 0; i < cfg.trials; i++) {
    const r = await ctx.firmSwap([ctx.route("E")], dust);
    if (r.events.filled) fills++;
  }
  const afterRouter = await ctx.stats(hook);

  // arm 2: canary probes from other sender identities
  let probes = 0;
  for (const idx of [0, 1, 2, 3]) {
    await ctx.probe("E", dust, idx);
    probes++;
    if ((await ctx.status(hook)) === "BLOCKED") break;
  }
  const afterCanary = await ctx.stats(hook);

  return {
    id: "B4",
    title: "Sender-aware hook (why the canary matters)",
    method: `FixtureSenderAwareHook: ${cfg.trials} FirmRouter swaps (router only), then up to 4 CanaryRunner probes from distinct ProbeSender identities.`,
    tables: [
      {
        table: {
          headers: ["Arm", "Executions", "Strikes recorded", "Status after", "Detected"],
          rows: [
            ["Start", "-", s0.strikes, startStatus, "-"],
            ["FirmRouter only", `${fills}/${cfg.trials} filled`, afterRouter.strikes - s0.strikes, afterRouter.status, afterRouter.strikes > s0.strikes ? "yes" : "no"],
            ["Canary probes", `${probes} probe(s)`, afterCanary.strikes - afterRouter.strikes, afterCanary.status, afterCanary.strikes > afterRouter.strikes ? "yes" : "no"],
          ],
        },
      },
    ],
    notes: [
      "A determined hook could try to recognise probes (the arXiv paper documents propAMMs penalising callers by address and bytecode fingerprint). This is an arms race, not a solved problem; ProbeSender addresses are deterministic CREATE2 contracts and can be fingerprinted.",
    ],
  };
};
