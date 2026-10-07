import type { Address, PublicClient } from "viem";
import { ScoreboardAbi } from "./abis/Scoreboard";
import { STATUS_NAMES, type HookStatsT, type StatusName } from "./types";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Status of many hooks in one Multicall3 batch. Hookless (zero address) is always NORMAL. */
export async function readStatuses(
  client: PublicClient,
  scoreboard: Address,
  hooks: Address[],
): Promise<Map<string, StatusName>> {
  const out = new Map<string, StatusName>();
  const real = [...new Set(hooks.map((h) => h.toLowerCase() as Address))].filter((h) => h !== ZERO);
  if (hooks.some((h) => h.toLowerCase() === ZERO)) out.set(ZERO, "NORMAL");
  if (real.length === 0) return out;
  const res = await client.multicall({
    allowFailure: false,
    contracts: real.map((h) => ({ address: scoreboard, abi: ScoreboardAbi, functionName: "statusOf", args: [h] }) as const),
  });
  real.forEach((h, i) => out.set(h, STATUS_NAMES[Number(res[i])] ?? "UNRATED"));
  return out;
}

/** Full statistics of one hook. */
export async function readHookStats(client: PublicClient, scoreboard: Address, hook: Address): Promise<HookStatsT> {
  const s = await client.readContract({ address: scoreboard, abi: ScoreboardAbi, functionName: "stats", args: [hook] });
  return { ...s, status: STATUS_NAMES[Number(s.status)] ?? "UNRATED" } as HookStatsT;
}

/** Tolerance in bps that the router would apply to this hook right now. */
export async function readTolerances(
  client: PublicClient,
  scoreboard: Address,
  hooks: Address[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(hooks.map((h) => h.toLowerCase() as Address))];
  if (uniq.length === 0) return out;
  const res = await client.multicall({
    allowFailure: false,
    contracts: uniq.map((h) => ({ address: scoreboard, abi: ScoreboardAbi, functionName: "toleranceBps", args: [h] }) as const),
  });
  uniq.forEach((h, i) => out.set(h, Number(res[i])));
  return out;
}
