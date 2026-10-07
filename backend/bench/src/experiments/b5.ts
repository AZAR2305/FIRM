import {
  FirmRouterAbi,
  IV4QuoterAbi,
  RawRouterAbi,
} from "@firm/shared";
import { E18 } from "../ctx";
import { percentile, tok, type ExperimentResult } from "../stats";
import type { Experiment } from "./types";

const REPS = 5;

/** B5 Gas overhead: the same swap through RawRouter and FirmRouter on the honest pool (and the hookless pool). */
export const b5: Experiment = async (ctx, cfg): Promise<ExperimentResult> => {
  const amount = 100n * E18;
  await ctx.fund(amount * 40n);
  const rows: (string | number)[][] = [];

  for (const pool of ["A", "C"]) {
    const rawUsed: number[] = [];
    const firmUsed: number[] = [];
    let price = 0n;
    for (let i = 0; i < REPS; i++) {
      const raw = await ctx.rawSwap(pool, amount);
      rawUsed.push(Number(raw.tx.receipt.gasUsed));
      price = raw.tx.receipt.effectiveGasPrice;
      const firm = await ctx.firmSwap([ctx.route(pool)], amount);
      firmUsed.push(Number(firm.tx.receipt.gasUsed));
    }
    // gas the transaction would need: eth_estimateGas finds the smallest limit that succeeds
    const rawEst = await ctx.client.estimateContractGas({
      address: ctx.dep.core.rawRouter.address,
      abi: RawRouterAbi,
      functionName: "swapExactInRaw",
      args: [ctx.route(pool), amount, 0n, ctx.me],
      account: ctx.me,
    });
    const firmEst = await ctx.client.estimateContractGas({
      address: ctx.dep.core.firmRouter.address,
      abi: FirmRouterAbi,
      functionName: "swapExactIn",
      args: [[ctx.route(pool)], amount, 0n, ctx.me, BigInt(Math.floor(Date.now() / 1000) + 3600)],
      account: ctx.me,
    });
    const { result } = await ctx.client.simulateContract({
      address: ctx.dep.infra.v4Quoter,
      abi: IV4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: ctx.poolKey(pool), zeroForOne: ctx.zeroForOne, exactAmount: amount, hookData: "0x" }],
      account: ctx.me,
    });
    const rawMed = percentile(rawUsed, 50);
    const firmMed = percentile(firmUsed, 50);
    rows.push([
      pool === "A" ? "A (hookless)" : "C (honest hook)",
      rawMed,
      firmMed,
      `${(firmMed / rawMed).toFixed(2)}x`,
      Number(rawEst),
      Number(firmEst),
      `${(Number(firmEst) / Number(rawEst)).toFixed(2)}x`,
      Number(result[1]),
      `${tok(BigInt(firmEst) * price)} MON vs ${tok(BigInt(rawEst) * price)} MON`,
    ]);
  }

  return {
    id: "B5",
    title: "Gas overhead",
    method: `Median of ${REPS} swaps of 100 tUSD through RawRouter and FirmRouter (single route) per pool; plus eth_estimateGas for each (the smallest gas limit that succeeds) and the V4 Quoter's own gas estimate per leg.`,
    tables: [
      {
        table: {
          headers: ["Pool", "Raw gas used", "FIRM gas used", "Used ratio", "Raw gas limit needed", "FIRM gas limit needed", "Limit ratio", "Quoter gas / leg", "Cost at limit (FIRM vs Raw)"],
          rows,
        },
      },
    ],
    notes: [
      "Monad charges gas on the gas LIMIT, not gas used. The 'limit needed' columns (eth_estimateGas) are what a user pays; the ratio of limits is the honest overhead figure. 'Used' ratios understate it.",
      "Why the limit ratio is far above the used ratio: FirmRouter refuses to start a quote or a leg unless gasleft() covers the gas cap (default 700,000) plus a reserve, so that a starved sub-call can never produce a false strike. The smallest valid gas limit is therefore about 0.9M even though a single protected swap uses about 0.2M. The defaults are deliberately conservative until Monad's repriced schedule has been measured; lowering them with setCaps after the testnet measurement lowers the limit users pay for.",
      "FIRM adds one in-transaction Quoter call plus Scoreboard bookkeeping per leg. A fallback chain costs more: each rejected leg adds a quote, a reverted leg and a strike write.",
      "Local anvil forks use Ethereum gas rules, not Monad's repriced schedule, so numbers from a fork are indicative only; the committed testnet numbers are the ones to quote.",
    ],
  };
};
