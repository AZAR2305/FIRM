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
      "The limit ratio is close to the used ratio because FirmRouter has no up-front gas requirement: a quote or leg that succeeds on less than its cap is fine, and a failure without its full cap reverts (InsufficientGas) instead of skipping or striking, which keeps eth_estimateGas honest. The first version demanded cap + reserve up front and needed a limit about 5x the raw swap's (docs/GAS.md).",
      "Hostile paths cost more: a gas-griefing first route can burn its whole leg cap before the router falls back, so a correctly sized limit for such a swap is about 1.0M to 1.3M (Monad-adjusted estimate, docs/GAS.md). That is paid once per hostile hook, which is then BLOCKED.",
      "FIRM adds one in-transaction Quoter call plus Scoreboard bookkeeping per leg. A fallback chain costs more: each rejected leg adds a quote, a reverted leg and a strike write.",
      "Local anvil forks use Ethereum gas rules, not Monad's repriced schedule, so numbers from a fork are indicative only; the committed testnet numbers are the ones to quote.",
    ],
  };
};
