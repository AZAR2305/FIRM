"use client";

import { useEffect, useState } from "react";
import { ENVIO_URL } from "@/lib/envio";
import { relativeTime, shortAddress } from "@/lib/format";
import { useActivity } from "@/hooks/useBoard";
import { EmptyState, ErrorState, Loading } from "./States";
import { TxLink } from "./TxLink";

const TONE: Record<string, string> = {
  strike: "border-bad/70 text-bad",
  fill: "border-ok/70 text-ok",
  probe: "border-brand/70 text-brand",
  status: "border-warn/70 text-warn",
  skip: "border-idle/70 text-idle",
};
const LABEL: Record<string, string> = { strike: "Strike", fill: "Fill", probe: "Probe", status: "Status", skip: "Skip" };

/** Live activity from the Envio index: every fill, strike, probe, skip and status change, each with its transaction on the block explorer. */
export function ActivityFeed({ hook, title = "Live activity", limit = 12 }: { hook?: string; title?: string; limit?: number }) {
  const q = useActivity(hook, limit);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="card p-5" aria-labelledby="activity-h" data-testid="activity-feed">
      <h2 id="activity-h" className="mb-3 text-lg font-bold">
        {title}
      </h2>
      {!ENVIO_URL ? (
        <EmptyState title="Activity history needs Envio">
          This feed is read from the Envio index. Set <span className="mono">NEXT_PUBLIC_ENVIO_GRAPHQL_URL</span> to enable it. There is no cheap way to rebuild history from the
          chain in a browser, so it is not faked.
        </EmptyState>
      ) : q.isLoading ? (
        <Loading what="Reading the Envio index" />
      ) : q.isError ? (
        <ErrorState title="Envio did not answer" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState title="No activity yet">Fills, strikes and probes appear here as soon as the index sees them.</EmptyState>
      ) : (
        <ol className="space-y-2" data-testid="activity-list">
          {q.data.map((a, i) => (
            <li key={`${a.txHash ?? "s"}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-kind={a.kind}>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[a.kind]}`}>{LABEL[a.kind]}</span>
              <span>{a.text}</span>
              {a.hook ? <span className="mono text-xs text-mute">hook {shortAddress(a.hook)}</span> : null}
              <span className="text-xs text-mute">{now == null ? "" : relativeTime(a.ts, now)}</span>
              {a.txHash ? <TxLink hash={a.txHash} /> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
