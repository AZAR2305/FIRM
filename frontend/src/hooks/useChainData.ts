"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Abi, Address, PublicClient } from "viem";
import { REFRESH_MS, monadTestnet } from "@/lib/config";
import { deployments, mustDeployments, tokens, ZERO_ADDRESS } from "@/lib/deployments";
import { planRoute, type Candidate, type PoolKeyT, type RoutePlan } from "@/lib/routes";
import { statusName, STATUS_ORDER, type StatusName } from "@/lib/status";

function useClient() {
  return usePublicClient({ chainId: monadTestnet.id });
}

/**
 * Many reads in ONE eth_call through Multicall3 (address from deployments/10143.json). The public Monad RPC limits a client to about
 * 15 requests per second and counts every call of a JSON-RPC batch, so reading each value separately fails on the real network
 * (found by running the app against it). `batchSize: 0` stops viem from splitting the calls into several requests.
 */
async function readMany(client: PublicClient, calls: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }[]) {
  const d = mustDeployments();
  return client.multicall({ multicallAddress: d.infra.multicall3, batchSize: 0, allowFailure: true, contracts: calls as never }) as Promise<
    ({ status: "success"; result: unknown } | { status: "failure"; error: Error })[]
  >;
}

const okOr = <T,>(r: { status: string; result?: unknown } | undefined, fallback: T): T => (r && r.status === "success" ? (r.result as T) : fallback);

/** tUSD and tUSDC balances of an account (one request). */
export function useBalances(account?: Address) {
  const client = useClient();
  return useQuery({
    queryKey: ["balances", account],
    enabled: !!deployments && !!client && !!account,
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const d = mustDeployments();
      const t = tokens(d);
      const abi = d.abis.MockToken;
      const [a, b] = await readMany(client!, [
        { address: t.tUSD.address, abi, functionName: "balanceOf", args: [account!] },
        { address: t.tUSDC.address, abi, functionName: "balanceOf", args: [account!] },
      ]);
      if (a?.status !== "success" || b?.status !== "success") throw new Error("Could not read your token balances");
      return { tUSD: a.result as bigint, tUSDC: b.result as bigint };
    },
  });
}

/** Allowance of `owner` toward `spender` on `token`. */
export function useAllowance(token?: Address, owner?: Address, spender?: Address) {
  const client = useClient();
  return useQuery({
    queryKey: ["allowance", token, owner, spender],
    enabled: !!deployments && !!client && !!token && !!owner && !!spender,
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      client!.readContract({
        address: token!,
        abi: mustDeployments().abis.MockToken,
        functionName: "allowance",
        args: [owner!, spender!],
      }) as Promise<bigint>,
  });
}

function poolKey(name: string): PoolKeyT {
  const d = mustDeployments();
  const p = d.pools.list[name]!;
  return { currency0: d.pools.currency0, currency1: d.pools.currency1, fee: p.fee, tickSpacing: d.pools.tickSpacing, hooks: p.hook };
}

/**
 * The route preview (spec 12.2): every seeded pool, its Scoreboard status and tolerance, and its Quoter quote for this trade, then
 * the same ordering rules as quote-api. Computed in the browser from the chain, so it works without any backend: ONE multicall for
 * the Scoreboard values and the quotes. Quotes are plain eth_calls, exactly like quote-api's, which is why a hook that quotes high
 * only to simulations shows up first here and is then caught on-chain by the advertisedOut check.
 */
export function useRoutePlan(zeroForOne: boolean, amountIn: bigint | null) {
  const client = useClient();
  return useQuery({
    queryKey: ["route-plan", zeroForOne, amountIn?.toString()],
    enabled: !!deployments && !!client && amountIn != null,
    refetchInterval: REFRESH_MS * 2,
    queryFn: async (): Promise<RoutePlan & { candidates: Candidate[]; unratedCap: bigint }> => {
      const d = mustDeployments();
      const names = Object.keys(d.pools.list);
      const sb = d.core.scoreboard.address;
      const keys = names.map(poolKey);

      const calls = [
        { address: sb, abi: d.abis.Scoreboard, functionName: "unratedCap" },
        ...keys.flatMap((k) => [
          { address: sb, abi: d.abis.Scoreboard, functionName: "statusOf", args: [k.hooks] },
          { address: sb, abi: d.abis.Scoreboard, functionName: "toleranceBps", args: [k.hooks] },
          {
            address: d.infra.v4Quoter,
            abi: d.abis.V4Quoter,
            functionName: "quoteExactInputSingle",
            args: [{ poolKey: k, zeroForOne, exactAmount: amountIn!, hookData: "0x" }],
          },
        ]),
      ];
      const res = await readMany(client!, calls);
      if (res[0]?.status !== "success") throw new Error("Could not read the Scoreboard");
      const unratedCap = res[0].result as bigint;

      const candidates: Candidate[] = names.map((name, i) => {
        const key = keys[i]!;
        const hookless = key.hooks.toLowerCase() === ZERO_ADDRESS;
        const status = okOr<number>(res[1 + i * 3], 0);
        const tol = okOr<number>(res[2 + i * 3], 10);
        const quote = okOr<readonly [bigint, bigint] | null>(res[3 + i * 3], null);
        return {
          name,
          description: d.pools.list[name]!.description,
          poolId: d.pools.list[name]!.poolId,
          key,
          status: hookless ? "NORMAL" : statusName(status),
          toleranceBps: Number(tol),
          // a reverted Quoter call is a failed quote (the pool is skipped), not an error of the whole preview
          quotedOut: quote ? quote[0] : null,
        };
      });
      return { ...planRoute(candidates, amountIn!, unratedCap), candidates, unratedCap };
    },
  });
}

export interface HookRow {
  pool: string;
  description: string;
  hook: Address;
  status: StatusName;
  fills: number;
  strikes: number;
  probes: number;
  probeStrikes: number;
  /** cumulative shortfall bps / strikes, or null when never struck */
  avgShortfallBps: number | null;
  lastStrikeAt: number;
}

interface RawStats {
  fills: number;
  strikes: number;
  probes: number;
  probeStrikes: number;
  lastStrikeAt: bigint;
  cumShortfallBps: bigint;
  status: number;
}

/** The leaderboard (spec 12.2): Scoreboard.stats for every hook of the seeded pools in one request, sorted by status then strikes. */
export function useLeaderboard() {
  const client = useClient();
  return useQuery({
    queryKey: ["leaderboard"],
    enabled: !!deployments && !!client,
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const d = mustDeployments();
      const entries = Object.entries(d.pools.list).filter(([, p]) => p.hook.toLowerCase() !== ZERO_ADDRESS);
      const res = await readMany(
        client!,
        entries.map(([, p]) => ({ address: d.core.scoreboard.address, abi: d.abis.Scoreboard, functionName: "stats", args: [p.hook] })),
      );
      const rows: HookRow[] = entries.map(([pool, p], i) => {
        const r = res[i];
        if (r?.status !== "success") throw new Error(`Could not read the Scoreboard for Pool ${pool}`);
        const s = r.result as RawStats;
        return {
          pool,
          description: p.description,
          hook: p.hook,
          status: statusName(s.status),
          fills: Number(s.fills),
          strikes: Number(s.strikes),
          probes: Number(s.probes),
          probeStrikes: Number(s.probeStrikes),
          avgShortfallBps: s.strikes > 0 ? Number(s.cumShortfallBps) / Number(s.strikes) : null,
          lastStrikeAt: Number(s.lastStrikeAt),
        };
      });
      rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.strikes - a.strikes || a.pool.localeCompare(b.pool));
      return {
        rows,
        hookless: Object.entries(d.pools.list)
          .filter(([, p]) => p.hook.toLowerCase() === ZERO_ADDRESS)
          .map(([n, p]) => ({ pool: n, description: p.description })),
        updatedAt: Date.now(),
      };
    },
  });
}
