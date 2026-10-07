import { lossVsBestHonestBps, shortfallBps } from "@firm/shared";
import { E18 } from "../ctx";
import { bps, mean, sum, tok, type ExperimentResult } from "../stats";
import type { Experiment } from "./types";

/**
 * B3 User loss. The same trade through the unprotected RawRouter (which trusts the best quote, Pool B) and through
 * FirmRouter with routes [B, C, A]. B is reinstated before each FirmRouter trial so FIRM must catch it unaided.
 */
export const b3: Experiment = async (ctx, cfg): Promise<ExperimentResult> => {
  const amount = cfg.tradeTokens * E18;
  await ctx.fund(amount * BigInt(cfg.trials) * 2n + 1000n * E18);

  const rows: (string | number)[][] = [];
  const rawLossQuote: bigint[] = [];
  const firmLossQuote: bigint[] = [];
  const rawLossHonest: bigint[] = [];
  const firmLossHonest: bigint[] = [];
  const rawTokensLost: bigint[] = [];
  const firmTokensLost: bigint[] = [];
  let firmRejectedB = 0;

  for (let i = 0; i < cfg.trials; i++) {
    const qB = await ctx.quote("B", amount);
    const qC = await ctx.quote("C", amount); // best honest alternative
    const raw = await ctx.rawSwap("B", amount);

    await ctx.reinstateIfBlocked(ctx.hook("B"));
    const firm = await ctx.firmSwap([ctx.route("B"), ctx.route("C"), ctx.route("A")], amount);
    if (firm.events.rejected.some((r) => r.hook === ctx.hook("B"))) firmRejectedB++;
    // loss vs quote of the leg that actually paid the user
    const paid = firm.events.filled;
    const firmShort = paid ? shortfallBps(paid.quotedOut, paid.settledOut) : 10_000n;
    const firmQuote = paid ? paid.quotedOut : 0n;

    const rawShort = shortfallBps(qB, raw.out);
    rawLossQuote.push(rawShort);
    firmLossQuote.push(firmShort);
    rawLossHonest.push(lossVsBestHonestBps(qC, raw.out));
    firmLossHonest.push(lossVsBestHonestBps(qC, firm.out));
    rawTokensLost.push(qB > raw.out ? qB - raw.out : 0n);
    firmTokensLost.push(firmQuote > firm.out ? firmQuote - firm.out : 0n);
    rows.push([i + 1, tok(qB), tok(raw.out), rawShort.toString(), tok(firm.out), firmShort.toString(), firm.leg]);
  }

  return {
    id: "B3",
    title: "User loss",
    method: `${cfg.trials} swaps of ${cfg.tradeTokens} tUSD through RawRouter (best quote: Pool B) and through FirmRouter [B, C, A], with Pool B quoting best and reinstated before each FirmRouter trial.`,
    tables: [
      {
        caption: "Aggregate",
        table: {
          headers: ["Metric", "RawRouter (unprotected)", "FirmRouter"],
          rows: [
            ["Mean loss vs quote", bps(mean(rawLossQuote)), bps(mean(firmLossQuote))],
            ["Mean loss vs best honest alternative", bps(mean(rawLossHonest)), bps(mean(firmLossHonest))],
            ["Total tokens lost vs quote", tok(sum(rawTokensLost)), tok(sum(firmTokensLost))],
            ["Pool B rejected by FirmRouter", "n/a", `${firmRejectedB}/${cfg.trials}`],
          ],
        },
      },
      {
        caption: "Per trade (amounts in tUSDC; shortfall in bps; leg = index of the route that filled)",
        table: { headers: ["#", "Quote B", "Raw received", "Raw shortfall", "FIRM received", "FIRM shortfall", "FIRM leg"], rows },
      },
    ],
    notes: [
      "loss_vs_quote_bps = shortfall_bps of the leg that actually paid the user; loss_vs_best_honest = (best honest quote - received) / best honest quote * 10000, where the best honest alternative is Pool C's quote.",
      "FirmRouter's loss vs best honest alternative is the price of the honest pool being slightly worse than the spoofed quote, not a hidden fee.",
      "B is reinstated before each FirmRouter trial, so these are first-encounter results. In steady state B stays BLOCKED and is skipped without being tried.",
    ],
  };
};
