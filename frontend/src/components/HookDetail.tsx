"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { deployments } from "@/lib/deployments";
import { canChangeSwapAmounts, decodeHookFlags, describeFlags } from "@/lib/flags";
import { pct, relativeTime } from "@/lib/format";
import { useBoard } from "@/hooks/useBoard";
import { ActivityFeed } from "./ActivityFeed";
import { SourceBadge } from "./SourceBadge";
import { EmptyState, ErrorState, Loading, NotDeployed } from "./States";
import { StatusChip } from "./StatusChip";
import { AddressLink } from "./TxLink";

interface ReportResponse {
  mode: "deterministic" | "llm";
  text: string;
  model?: string;
  note?: string;
  error?: string;
}

/** /hooks/[address]: one hook's status, permissions, evidence and strike history. */
export function HookDetail({ address }: { address: string }) {
  if (!deployments) return <NotDeployed />;
  return <Inner address={address} />;
}

function Inner({ address }: { address: string }) {
  const d = deployments!;
  const board = useBoard();
  const entry = Object.entries(d.pools.list).find(([, p]) => p.hook.toLowerCase() === address.toLowerCase());
  const report = useQuery({
    queryKey: ["hook-report", address.toLowerCase()],
    enabled: !!entry,
    refetchInterval: 20_000,
    retry: 0,
    queryFn: async (): Promise<ReportResponse> => {
      const r = await fetch(`/api/hook-report?hook=${address}`);
      const j = (await r.json()) as ReportResponse;
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
  });

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return <ErrorState title="That is not an address" />;
  if (!entry || entry[1].hook.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    return (
      <EmptyState title="This address is not a tracked hook">
        Only the hooks of the seeded pools are tracked here. <Link href="/leaderboard">See the leaderboard</Link>.
      </EmptyState>
    );
  }
  const [pool, p] = entry;
  const row = board.data?.rows.find((r) => r.hook.toLowerCase() === address.toLowerCase());
  const flags = decodeHookFlags(address);
  const risky = canChangeSwapAmounts(address);
  const fixture = Object.values(d.fixtures).find((f) => f.address.toLowerCase() === address.toLowerCase());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">Pool {pool}</h1>
        {row ? <StatusChip status={row.status} /> : null}
      </div>
      <p className="text-sm text-mute">{p.description}. This hook is one of our own test fixtures.</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <AddressLink address={address} label={address} />
        {fixture ? <span className="text-mute">source verification: {fixture.verification}</span> : null}
        <Link href="/leaderboard">All hooks</Link>
      </div>

      {board.data ? <SourceBadge board={board.data} /> : board.isLoading ? <Loading what="Reading the Scoreboard" /> : board.isError ? <ErrorState title="Could not read the Scoreboard" error={board.error} /> : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Evidence" data-testid="hook-stats">
        {[
          ["Fills", row?.fills],
          ["Strikes", row?.strikes],
          ["Canary probes", row ? `${row.probes}${row.probeStrikes ? ` (${row.probeStrikes} struck)` : ""}` : undefined],
          ["Average shortfall", row ? (row.avgShortfallBps == null ? "none" : pct(BigInt(Math.round(row.avgShortfallBps)))) : undefined],
        ].map(([k, v]) => (
          <div key={String(k)} className="card p-4">
            <p className="text-xs text-mute">{k}</p>
            <p className="mono text-2xl font-bold">{v ?? "..."}</p>
          </div>
        ))}
      </section>
      {row ? <p className="text-xs text-mute">Last strike: {row.lastStrikeAt ? relativeTime(row.lastStrikeAt) : "never"}.</p> : null}

      <section className="card p-5" aria-labelledby="flags-h" data-testid="hook-flags">
        <h2 id="flags-h" className="mb-2 text-lg font-bold">
          What this hook is allowed to do
        </h2>
        <p className="mb-3 text-xs text-mute">Decoded from the low 14 bits of the hook&apos;s address, which Uniswap v4 requires to match its permissions.</p>
        <ul className="mb-3 flex flex-wrap gap-2">
          {flags.length === 0 ? <li className="text-sm text-mute">no permissions</li> : null}
          {flags.map((f) => (
            <li key={f} className={`mono rounded border px-2 py-0.5 text-xs ${f.endsWith("RETURNS_DELTA") && f.includes("SWAP") ? "border-warn/70 text-warn" : "border-line text-mute"}`}>
              {f}
            </li>
          ))}
        </ul>
        <p className="text-sm">{describeFlags(address)}</p>
        {risky ? <p className="mt-2 text-sm text-warn">A hook that can change swap amounts is the kind a quote cannot vouch for. That is what FIRM checks.</p> : null}
      </section>

      <section className="card p-5" aria-labelledby="report-h" data-testid="hook-report">
        <h2 id="report-h" className="mb-2 text-lg font-bold">
          Risk summary
        </h2>
        {report.isLoading ? (
          <Loading what="Writing the summary" />
        ) : report.isError ? (
          <ErrorState title="No summary available" error={report.error} />
        ) : report.data ? (
          <>
            <p className="text-sm" data-testid="report-text">
              {report.data.text}
            </p>
            <p className="mt-2 text-xs text-mute" data-testid="report-mode">
              {report.data.mode === "llm"
                ? `AI-written, advisory (model: ${report.data.model}). Built only from the on-chain facts above; it decides nothing.`
                : "Deterministic summary built from the on-chain facts above. No language model was used."}
              {report.data.note ? ` ${report.data.note}` : ""}
            </p>
          </>
        ) : null}
      </section>

      <ActivityFeed hook={address.toLowerCase()} title="Strike and fill history" limit={20} />
    </div>
  );
}
