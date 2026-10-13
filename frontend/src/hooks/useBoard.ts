"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { REFRESH_MS, monadTestnet } from "@/lib/config";
import { deployments, mustDeployments, ZERO_ADDRESS } from "@/lib/deployments";
import { activityQuery, ENVIO_URL, EnvioError, HOOKS_QUERY, META_QUERY, gql, toActivity, type ActivityData, type ActivityItem, type HooksData, type MetaData } from "@/lib/envio";
import { STATUS_NAMES, type StatusName } from "@/lib/status";
import { hooklessPools, readBoardFromChain, sortRows, type HookRow } from "./useChainData";

export interface Board {
  rows: HookRow[];
  hookless: { pool: string; description: string }[];
  updatedAt: number;
  /** where the numbers came from: stated on screen, never hidden */
  source: "envio" | "chain";
  note: string;
  /** Envio only: how far the index has processed, and the chain head it knows */
  indexedBlock?: number;
  headBlock?: number;
  /** ms the request took */
  ms: number;
}

/**
 * The leaderboard. With NEXT_PUBLIC_ENVIO_GRAPHQL_URL set it is powered by Envio HyperIndex (HyperSync); if Envio is not configured or does not
 * answer it reads the Scoreboard contract directly and SAYS SO in `note`, so a viewer can always tell which one they are looking at.
 */
export function useBoard() {
  const client = usePublicClient({ chainId: monadTestnet.id });
  return useQuery({
    queryKey: ["board", ENVIO_URL],
    enabled: !!deployments && !!client,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<Board> => {
      const d = mustDeployments();
      const t0 = Date.now();
      let why = "Envio is not configured (NEXT_PUBLIC_ENVIO_GRAPHQL_URL): reading the Scoreboard contract directly.";
      if (ENVIO_URL) {
        try {
          const [data, metaData] = await Promise.all([gql<HooksData>(HOOKS_QUERY), gql<MetaData>(META_QUERY).catch(() => null)]);
          const byHook = new Map(data.Hook.map((h) => [h.id.toLowerCase(), h]));
          const rows: HookRow[] = Object.entries(d.pools.list)
            .filter(([, p]) => p.hook.toLowerCase() !== ZERO_ADDRESS)
            .map(([pool, p]) => {
              const h = byHook.get(p.hook.toLowerCase());
              const strikes = h?.strikes ?? 0;
              return {
                pool,
                description: p.description,
                hook: p.hook,
                status: (h && (STATUS_NAMES as readonly string[]).includes(h.status) ? h.status : "UNRATED") as StatusName,
                fills: h?.fills ?? 0,
                strikes,
                probes: h?.probes ?? 0,
                probeStrikes: h?.probeStrikes ?? 0,
                avgShortfallBps: strikes > 0 ? Number(h?.avgShortfallBps ?? 0) : null,
                lastStrikeAt: h?.lastStrikeAt ?? 0,
              };
            });
          const meta = metaData?.chain_metadata[0];
          return {
            rows: sortRows(rows),
            hookless: hooklessPools(),
            updatedAt: Date.now(),
            source: "envio",
            note: "Powered by Envio HyperIndex, reading Monad Testnet through HyperSync.",
            indexedBlock: meta?.latest_processed_block,
            headBlock: meta?.block_height,
            ms: Date.now() - t0,
          };
        } catch (e) {
          why = `Envio did not answer (${e instanceof EnvioError ? e.message : "error"}): reading the Scoreboard contract directly instead.`;
        }
      }
      const chain = await readBoardFromChain(client!);
      return { rows: sortRows(chain.rows), hookless: chain.hookless, updatedAt: Date.now(), source: "chain", note: why, ms: Date.now() - t0 };
    },
  });
}

/** Recent fills, strikes, probes, skips and status changes (optionally of one hook), from Envio. Not available without Envio: there is no cheap chain fallback for history. */
export function useActivity(hook?: string, limit = 12) {
  return useQuery({
    queryKey: ["activity", ENVIO_URL, hook ?? "all", limit],
    enabled: !!deployments && !!ENVIO_URL,
    refetchInterval: REFRESH_MS,
    retry: 0,
    queryFn: async (): Promise<ActivityItem[]> => {
      const d = mustDeployments();
      const names = new Map(Object.entries(d.pools.list).map(([n, p]) => [p.poolId.toLowerCase(), n]));
      const data = await gql<ActivityData>(activityQuery(hook), { n: limit });
      return toActivity(data, (id) => names.get(id.toLowerCase()) ?? id.slice(0, 10), limit);
    },
  });
}
