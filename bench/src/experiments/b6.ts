import { E18 } from "../ctx";
import { tok, type ExperimentResult } from "../stats";
import type { Experiment } from "./types";

/** B6 Resilience: gas-grief and revert fixtures must never make FirmRouter revert as a whole. */
export const b6: Experiment = async (ctx): Promise<ExperimentResult> => {
  const amount = 100n * E18;
  await ctx.fund(amount * 20n);
  const rows: (string | number)[][] = [];

  for (const [pool, label] of [
    ["G", "FixtureGasGriefHook"],
    ["R", "FixtureRevertHook"],
  ] as const) {
    const hook = ctx.hook(pool);

    // 1) hostile hook first, hookless baseline second
    await ctx.reinstateIfBlocked(hook);
    let withFallback = "tx reverted as a whole";
    let filledLeg = "-";
    let received = "-";
    let hostileLeg = "-";
    try {
      const r = await ctx.firmSwap([ctx.route(pool), ctx.route("A")], amount);
      withFallback = "no, call succeeded";
      filledLeg = String(r.leg);
      received = tok(r.out);
      const rej = r.events.rejected.find((x) => x.hook === hook);
      hostileLeg = rej ? `rejected, execFailed=${rej.execFailed}` : "not rejected";
    } catch {
      /* the failure text above stays */
    }

    // 2) hostile hook as the only route: the input must come back and the strike must persist
    await ctx.reinstateIfBlocked(hook);
    const strikesBefore = (await ctx.stats(hook)).strikes;
    const inBefore = await ctx.balance(ctx.tokenIn);
    let onlyRoute = "tx reverted as a whole";
    let refunded = "-";
    let strikesAdded = "-";
    let status = "-";
    try {
      const r = await ctx.firmSwap([ctx.route(pool)], amount);
      const after = await ctx.stats(hook);
      onlyRoute = r.events.noFill ? "NoFill, returned normally" : `unexpected fill at leg ${r.leg}`;
      refunded = (await ctx.balance(ctx.tokenIn)) === inBefore ? "yes, exact" : "NO";
      strikesAdded = String(after.strikes - strikesBefore);
      status = after.status;
    } catch {
      /* the failure text above stays */
    }
    rows.push([label, withFallback, filledLeg, received, hostileLeg, onlyRoute, refunded, strikesAdded, status]);
  }

  return {
    id: "B6",
    title: "Resilience",
    method:
      "Hostile hooks as the first route ([hostile, A]) and as the only route ([hostile]). Success means FirmRouter never reverts as a whole, input is refunded or filled elsewhere, and the strike persists.",
    tables: [
      {
        table: {
          headers: ["Fixture", "Whole-tx revert with fallback?", "Filled leg", "Received (tUSDC)", "Hostile leg", "Only-route outcome", "Input refunded", "Strikes added", "Status"],
          rows,
        },
      },
    ],
    notes: [
      "Each leg runs in a gas-capped self-call and at most 68 bytes of return data are copied, so a hook that burns all gas or reverts (including with a huge payload, covered by the Foundry suite) cannot break the caller.",
      "Hostile legs consume up to the leg gas cap, which is paid because Monad charges the gas limit: fallback chains cost more than their execution suggests.",
    ],
  };
};
