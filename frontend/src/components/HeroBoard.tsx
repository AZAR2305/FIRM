"use client";

import Link from "next/link";
import { StatusChip } from "@/components/StatusChip";
import { useBoard } from "@/hooks/useBoard";

/** A compact live view of the Scoreboard for the landing page. Same data and same source label as the leaderboard: nothing here is typed in. */
export function HeroBoard() {
  const { data, isLoading, error } = useBoard();
  return (
    <div className="card overflow-hidden" data-testid="hero-board">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <p className="text-sm font-semibold">Live scoreboard</p>
        <p className="mono flex items-center gap-2 text-[0.7rem] uppercase tracking-wider text-mute">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${data ? "bg-ok" : "bg-idle"}`} />
          {data ? (data.source === "envio" ? "Envio HyperIndex" : "Direct chain read") : isLoading ? "Loading" : "Unavailable"}
        </p>
      </div>
      {error ? (
        <p className="px-5 py-6 text-sm text-mute">The scoreboard could not be read right now.</p>
      ) : (
        <ul className="divide-y divide-line">
          {(data?.rows ?? Array.from({ length: 5 }, () => null)).slice(0, 7).map((r, n) => (
            <li key={r?.hook ?? n} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              {r ? (
                <>
                  <Link href={`/hooks/${r.hook}`} className="min-w-0 truncate font-medium text-ink no-underline hover:underline">
                    Pool {r.pool}
                    <span className="ml-2 text-xs font-normal text-mute">{r.description.replace(/\(.*\)/, "").trim()}</span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="mono text-xs text-mute">{r.strikes} strike{r.strikes === 1 ? "" : "s"}</span>
                    <StatusChip status={r.status} />
                  </span>
                </>
              ) : (
                <span className="h-5 w-full animate-pulse rounded bg-panel2" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line px-5 py-3 text-xs text-mute">
        {data?.source === "envio" && data.indexedBlock != null ? (
          <span className="mono">indexed to block {data.indexedBlock.toLocaleString("en-US")}</span>
        ) : (
          <span>Test hooks we wrote, on Monad Testnet.</span>
        )}
        <Link href="/leaderboard" className="ml-3 font-medium">Open the leaderboard</Link>
      </div>
    </div>
  );
}
