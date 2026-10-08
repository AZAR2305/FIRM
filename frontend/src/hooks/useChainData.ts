"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { REFRESH_MS, monadTestnet } from "@/lib/config";
import { deployments, mustDeployments, tokens, ZERO_ADDRESS } from "@/lib/deployments";
import { planRoute, type Candidate, type PoolKeyT, type RoutePlan } from "@/lib/routes";
import { statusName, STATUS_ORDER, type StatusName } from "@/lib/status";

function useClient() {
  return usePublicClient({ chainId: monadTestnet.id });
}

/** tUSD and tUSDC balances of an account. */
export function useBalances(account?: Address) {
  const client = useClient();
  return useQuery({
    queryKey: ["balances", account],
    enabled: !!deployments && !!client && !!account,
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const d = mustDeployments();
      const t = tokens(d);
      const read = (address: Address) =>
        client!.readContract({ address, abi: d.abis.MockToken, functionName: "balanceOf", args: [account!] }) as Promise<bigint>;
      const [tUSD, tUSDC] = await Promise.all([read(t.tUSD.address), read(t.tUSDC.address)]);
      return { tUSD, tUSDC };
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
 * the same ordering rules as quote-api. Computed in the browser from the chain, so it works without any backend. Quotes are plain
 * eth_calls, exactly like quote-api's, which is why a hook that quotes high only to simulations shows up first here and is
 * then caught on-chain by the advertisedOut check.
 */
export function useRoutePlan(zeroForOne: boolean, amountIn: bigint | null) {
  const client = useClient();
  return useQuery({
    queryKey: ["route-plan", zeroForOne, amountIn?.toString()],
    enabled: !!deployments && !!client && amountIn != null,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<RoutePlan & { candidates: Candidate[]; unratedCap: bigint }> => {
      const d = mustDeployments();
      const names = Object.keys(d.pools.list);
      const sb = d.core.scoreboard.address;
      const unratedCap = (await client!.readContract({ address: sb, abi: d.abis.Scoreboard, functionName: "unratedCap" })) as bigint;

      const candidates = await Promise.all(
        names.map(async (name): Promise<Candidate> => {
          const key = poolKey(name);
          const hook = key.hooks;
          const hookless = hook.toLowerCase() === ZERO_ADDRESS;
          const [status, tol, quote] = await Promise.all([
            client!.readContract({ address: sb, abi: d.abis.Scoreboard, functionName: "statusOf", args: [hook] }) as Promise<number>,
            client!.readContract({ address: sb, abi: d.abis.Scoreboard, functionName: "toleranceBps", args: [hook] }) as Promise<number>,
            client!
              .simulateContract({
                address: d.infra.v4Quoter,
                abi: d.abis.V4Quoter,
                functionName: "quoteExactInputSingle",
                args: [{ poolKey: key, zeroForOne, exactAmount: amountIn!, hookData: "0x" }],
              })
              .then((r) => (r.result as readonly [bigint, bigint])[0])
              .catch(() => null),
          ]);
          return {
            name,
            description: d.pools.list[name]!.description,
            poolId: d.pools.list[name]!.poolId,
            key,
            status: hookless ? "NORMAL" : statusName(status),
            toleranceBps: Number(tol),
            quotedOut: quote,
          };
        }),
      );
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

/** The leaderboard (spec 12.2): Scoreboard.stats for every hook of the seeded pools, sorted by status then strikes. */
export function useLeaderboard() {
  const client = useClient();
  return useQuery({
    queryKey: ["leaderboard"],
    enabled: !!deployments && !!client,
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const d = mustDeployments();
      const entries = Object.entries(d.pools.list).filter(([, p]) => p.hook.toLowerCase() !== ZERO_ADDRESS);
      const rows: HookRow[] = await Promise.all(
        entries.map(async ([pool, p]) => {
          const s = (await client!.readContract({
            address: d.core.scoreboard.address,
            abi: d.abis.Scoreboard,
            functionName: "stats",
            args: [p.hook],
          })) as {
            fills: number;
            strikes: number;
            probes: number;
            probeStrikes: number;
            lastStrikeAt: bigint;
            cumShortfallBps: bigint;
            status: number;
          };
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
        }),
      );
      rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.strikes - a.strikes || a.pool.localeCompare(b.pool));
      return { rows, hookless: Object.entries(d.pools.list).filter(([, p]) => p.hook.toLowerCase() === ZERO_ADDRESS).map(([n, p]) => ({ pool: n, description: p.description })), updatedAt: Date.now() };
    },
  });
}
