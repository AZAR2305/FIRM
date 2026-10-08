"use client";

import { useEffect, useState } from "react";
import { REFRESH_MS } from "@/lib/config";
import { deployments } from "@/lib/deployments";
import { pct, relativeTime } from "@/lib/format";
import { useLeaderboard } from "@/hooks/useChainData";
import { EmptyState, ErrorState, Loading, NotDeployed } from "./States";
import { StatusChip } from "./StatusChip";
import { AddressLink } from "./TxLink";

/** Spec 12.2: hooks sorted by status then strikes; status chip, fills, strikes, probes, average shortfall, last strike. Auto-refresh. */
export function LeaderboardTable() {
  if (!deployments) return <NotDeployed />;
  return <Inner />;
}

function Inner() {
  const q = useLeaderboard();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (q.isLoading) return <Loading what="Reading the Scoreboard" />;
  if (q.isError) return <ErrorState title="Could not read the Scoreboard" error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data;
  if (!data || data.rows.length === 0) return <EmptyState title="No hooks tracked yet">Hooks appear here once pools with hooks are seeded.</EmptyState>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-mute" aria-live="polite" data-testid="refresh-line">
        Live from the Scoreboard contract, refreshed every {REFRESH_MS / 1000} s{q.isFetching ? " (refreshing)" : ""}. Last update{" "}
        {new Date(data.updatedAt).toLocaleTimeString()}.
      </p>
      <div className="card table-wrap">
        <table className="t" data-testid="leaderboard">
          <caption className="sr-only">Hooks ranked by status, then strikes</caption>
          <thead>
            <tr>
              <th scope="col">Hook</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">Fills</th>
              <th scope="col" className="text-right">Strikes</th>
              <th scope="col" className="text-right">Probes</th>
              <th scope="col" className="text-right">Avg shortfall</th>
              <th scope="col">Last strike</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.hook} data-pool={r.pool} data-status={r.status}>
                <td>
                  <strong>Pool {r.pool}</strong>
                  <div className="text-xs text-mute">{r.description}</div>
                  <AddressLink address={r.hook} />
                </td>
                <td>
                  <StatusChip status={r.status} />
                </td>
                <td className="mono text-right">{r.fills}</td>
                <td className="mono text-right">{r.strikes}</td>
                <td className="mono text-right">
                  {r.probes}
                  {r.probeStrikes > 0 ? <span className="text-bad"> ({r.probeStrikes} struck)</span> : null}
                </td>
                <td className="mono text-right">{r.avgShortfallBps == null ? "-" : pct(BigInt(Math.round(r.avgShortfallBps)))}</td>
                <td className="whitespace-nowrap">{now == null ? "..." : relativeTime(r.lastStrikeAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.hookless.length > 0 ? (
        <p className="text-xs text-mute">
          Not tracked: {data.hookless.map((h) => `Pool ${h.pool} (${h.description})`).join(", ")}. A pool without a hook has no hook behaviour to score and is always treated as NORMAL.
        </p>
      ) : null}
    </div>
  );
}
