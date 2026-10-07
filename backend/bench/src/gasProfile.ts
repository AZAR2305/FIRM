// Gas profile: measures what a quote, a swap leg and the Scoreboard writes really cost, then adds Monad's repricing, and
// recommends gas caps. Run against a fork (or the real testnet, if the RPC supports debug_traceCall):
//
//   FIRM_DEPLOYMENTS_PATH=... MONAD_TESTNET_RPC_URLS=... BENCH_PRIVATE_KEY=0x... pnpm gas-profile
//
// Why an estimate: a fork executes with Ethereum's gas schedule. Monad reprices cold accesses (docs.monad.xyz,
// "Opcode pricing": cold SLOAD 2,100 -> 8,100; cold account access 2,600 -> 10,100; SSTORE gains a page-load and
// page-write component, about +6,000 for a cold slot, state growth +17,000 only for brand-new slots). The profiler counts
// the distinct cold storage slots and accounts a call touches with the prestate tracer and adds those deltas. It is an
// ESTIMATE, to be replaced by eth_estimateGas on the real testnet once the contracts are deployed there.
import { encodeFunctionData, type Address, type Hex } from "viem";
import { z } from "zod";
import { IV4QuoterAbi, RawRouterAbi, FirmRouterAbi, ScoreboardAbi, loadDeployments } from "@firm/shared";
import { Ctx } from "./ctx";

/** Extra gas Monad charges per distinct cold storage slot / cold account, versus Ethereum (see the header). */
export const MONAD_COLD_SLOT_EXTRA = 6_000;
export const MONAD_COLD_ACCOUNT_EXTRA = 7_500;

export interface Prestate {
  [address: string]: { storage?: Record<string, string> };
}

export interface MonadEstimate {
  gasUsed: number;
  coldSlots: number;
  coldAccounts: number;
  /** gasUsed plus Monad's cold-access repricing */
  monadEstimate: number;
}

/**
 * @param gasUsed gas the call used on the Ethereum-schedule EVM
 * @param prestate accounts and storage slots the call touched (prestateTracer)
 * @param prewarmed accounts that are already warm at the start of a transaction (sender, target) and the zero address
 *        the tracer reports for the coinbase: they are not cold accesses
 */
export function monadEstimate(gasUsed: number, prestate: Prestate, prewarmed: string[]): MonadEstimate {
  const warm = new Set([...prewarmed, "0x0000000000000000000000000000000000000000"].map((a) => a.toLowerCase()));
  let coldSlots = 0;
  let coldAccounts = 0;
  for (const [addr, state] of Object.entries(prestate)) {
    coldSlots += Object.keys(state.storage ?? {}).length;
    if (!warm.has(addr.toLowerCase())) coldAccounts++;
  }
  return {
    gasUsed,
    coldSlots,
    coldAccounts,
    monadEstimate: gasUsed + coldSlots * MONAD_COLD_SLOT_EXTRA + coldAccounts * MONAD_COLD_ACCOUNT_EXTRA,
  };
}

/** margin x value, rounded up to a multiple of `step` */
export function recommend(value: number, margin: number, step: number): number {
  return Math.ceil((value * margin) / step) * step;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("gasProfile.ts")) {
  const env = z.object({ BENCH_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/), MARGIN: z.coerce.number().default(1.5) }).parse(process.env);
  const dep = loadDeployments();
  const ctx = new Ctx(dep, env.BENCH_PRIVATE_KEY as Hex);
  await ctx.fund(5_000n * 10n ** 18n);

  const call = async (from: Address, to: Address, data: Hex): Promise<MonadEstimate> => {
    const tx = { from, to, data };
    const gas = (await ctx.client.request({ method: "debug_traceCall", params: [tx, "latest", { tracer: "callTracer" }] } as never)) as { gasUsed: string };
    const pre = (await ctx.client.request({ method: "debug_traceCall", params: [tx, "latest", { tracer: "prestateTracer" }] } as never)) as Prestate;
    return monadEstimate(Number(BigInt(gas.gasUsed)), pre, [from, to]);
  };

  const amount = 100n * 10n ** 18n;
  const rows: { what: string; e: MonadEstimate }[] = [];
  const quotes: number[] = [];
  const legs: number[] = [];
  // hostile hooks (G, R) are meant to fail on the real path; their quote path is honest, so only skip their leg
  for (const pool of Object.keys(dep.pools!.list)) {
    const route = ctx.route(pool);
    const q = await call(ctx.me, dep.infra.v4Quoter, encodeFunctionData({ abi: IV4QuoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: route.key, zeroForOne: route.zeroForOne, exactAmount: amount, hookData: "0x" }] }));
    rows.push({ what: `quote  pool ${pool}`, e: q });
    quotes.push(q.monadEstimate);
    if (pool === "G" || pool === "R") continue;
    const leg = await call(ctx.me, dep.core.rawRouter.address, encodeFunctionData({ abi: RawRouterAbi, functionName: "swapExactInRaw", args: [route, amount, 0n, ctx.me] }));
    rows.push({ what: `leg    pool ${pool} (incl. token transfers)`, e: leg });
    legs.push(leg.monadEstimate);
  }

  // Work the router does AFTER a leg: Scoreboard writes. The router is the reporter, so impersonate it.
  const router = dep.core.firmRouter.address;
  await ctx.client.request({ method: "anvil_impersonateAccount", params: [router] } as never);
  await ctx.client.request({ method: "anvil_setBalance", params: [router, "0xde0b6b3a7640000"] } as never);
  const hook = ctx.hook("C");
  const pid = dep.pools!.list.C!.poolId;
  const strike = await call(router, dep.core.scoreboard.address, encodeFunctionData({ abi: ScoreboardAbi, functionName: "recordStrike", args: [hook, pid, 10n ** 21n, 0n, true] }));
  const fill = await call(router, dep.core.scoreboard.address, encodeFunctionData({ abi: ScoreboardAbi, functionName: "recordFill", args: [hook, pid, 10n ** 21n, 10n ** 21n] }));
  rows.push({ what: "Scoreboard.recordStrike", e: strike }, { what: "Scoreboard.recordFill", e: fill });

  // Whole protected swap (honest hook), for reference
  const whole = await call(ctx.me, router, encodeFunctionData({ abi: FirmRouterAbi, functionName: "swapExactIn", args: [[ctx.route("C")], amount, 0n, ctx.me, BigInt(Math.floor(Date.now() / 1000) + 3600)] }));
  rows.push({ what: "FirmRouter.swapExactIn [C] (whole)", e: whole });

  console.log("what".padEnd(44), "eth gas".padStart(9), "slots".padStart(6), "accts".padStart(6), "Monad est.".padStart(11));
  for (const { what, e } of rows) console.log(what.padEnd(44), String(e.gasUsed).padStart(9), String(e.coldSlots).padStart(6), String(e.coldAccounts).padStart(6), String(e.monadEstimate).padStart(11));

  const m = env.MARGIN;
  // post-leg work: a strike write plus the event, the next iteration's bookkeeping and a refund transfer (generous flat allowance)
  const postLeg = Math.max(strike.monadEstimate, fill.monadEstimate) + 60_000;
  const rec = { quoteCap: recommend(Math.max(...quotes), m, 25_000), legCap: recommend(Math.max(...legs), m, 25_000), reserve: recommend(postLeg, m, 25_000) };
  console.log(`\nworst honest quote (Monad est.): ${Math.max(...quotes)}   worst honest leg: ${Math.max(...legs)}   post-leg work: ${postLeg}`);
  console.log(`recommended caps at ${m}x margin: quoteGasCap ${rec.quoteCap}, legGasCap ${rec.legCap}, GAS_RESERVE ${rec.reserve}`);
  console.log(`=> a hostile leg needs a limit of about ${Math.round((whole.monadEstimate - 0) + rec.legCap * (64 / 63) + rec.reserve)} (honest path: about ${Math.round(whole.monadEstimate * 1.15)} with a 15% buffer)`);
}
