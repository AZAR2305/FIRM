import type { Hex } from "viem";

/**
 * Envio HyperIndex (GraphQL over Hasura): the leaderboard, the activity feed and the hook pages read from here when
 * NEXT_PUBLIC_ENVIO_GRAPHQL_URL is set. The indexer reads Monad Testnet through HyperSync (envio/config.yaml). It is display only:
 * no contract reads it, and when it is missing or down the app says so and reads the Scoreboard contract directly instead.
 */
export const ENVIO_URL = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL || "";

export class EnvioError extends Error {}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}, url = ENVIO_URL, timeoutMs = 8_000): Promise<T> {
  if (!url) throw new EnvioError("NEXT_PUBLIC_ENVIO_GRAPHQL_URL is not set");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }), signal: ctl.signal });
    if (!res.ok) throw new EnvioError(`Envio answered HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new EnvioError(json.errors[0]!.message);
    if (!json.data) throw new EnvioError("Envio returned no data");
    return json.data;
  } catch (e) {
    if (e instanceof EnvioError) throw e;
    throw new EnvioError(e instanceof Error && e.name === "AbortError" ? "Envio did not answer in time" : `Envio is unreachable: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

export interface EnvioHook {
  id: string;
  status: string;
  fills: number;
  strikes: number;
  probes: number;
  probeStrikes: number;
  cumShortfallBps: string;
  avgShortfallBps: string;
  lastStrikeAt: number | null;
  flags: string[];
}

export const HOOKS_QUERY = `query Hooks { Hook { id status fills strikes probes probeStrikes cumShortfallBps avgShortfallBps lastStrikeAt flags } chain_metadata { latest_processed_block block_height } }`;

export interface HooksData {
  Hook: EnvioHook[];
  chain_metadata: { latest_processed_block: number; block_height: number }[];
}

export type ActivityKind = "fill" | "strike" | "probe" | "status" | "skip";

export interface ActivityItem {
  kind: ActivityKind;
  /** unix seconds */
  ts: number;
  hook: string | null;
  txHash: Hex | null;
  text: string;
}

/** Hasura rejects `_eq: null`, so the hook filter is part of the query text, not a variable. `hook` is a lowercase address. */
export function activityQuery(hook?: string): string {
  const where = hook ? `, where: {hook_id: {_eq: "${hook.toLowerCase().replace(/[^0-9a-fx]/g, "")}"}}` : "";
  const q = (t: string, f: string) => `${t}(limit: $n, order_by: {ts: desc}${where}) { ${f} }`;
  return `query Activity($n: Int!) {
  ${q("Fill", "id ts txHash hook { id } pool { id } quotedOut settledOut legIndex")}
  ${q("Strike", "id ts txHash hook { id } pool { id } quotedOut settledOut shortfallBps execFailed")}
  ${q("Probe", "id ts txHash hook { id } probeSender shortfallBps strike")}
  ${q("StatusChange", "id ts hook { id } oldStatus newStatus reason")}
  ${q("Skip", "id ts txHash hook { id } reason")}
}`;
}

type Id = { id: string } | null;
export interface ActivityData {
  Fill: { id: string; ts: number; txHash: string; hook: Id; pool: { id: string }; quotedOut: string; settledOut: string; legIndex: number }[];
  Strike: { id: string; ts: number; txHash: string; hook: Id; pool: { id: string }; quotedOut: string; settledOut: string; shortfallBps: number; execFailed: boolean }[];
  Probe: { id: string; ts: number; txHash: string; hook: Id; probeSender: string; shortfallBps: number; strike: boolean }[];
  StatusChange: { id: string; ts: number; hook: Id; oldStatus: string; newStatus: string; reason: string }[];
  Skip: { id: string; ts: number; txHash: string; hook: Id; reason: number }[];
}

const SKIP: Record<number, string> = {
  0: "skipped: hook is BLOCKED",
  1: "skipped: UNRATED hook, trade above its cap",
  2: "skipped: could not be quoted",
  3: "skipped: could not meet the minimum",
  4: "skipped: in-transaction quote below the advertised quote",
};

/** Merges the five event tables into one feed, newest first. Text is a deterministic template (never an LLM). */
export function toActivity(d: ActivityData, poolName: (poolId: string) => string, limit = 20): ActivityItem[] {
  const out: ActivityItem[] = [];
  const hex = (s: string) => s as Hex;
  for (const f of d.Fill) out.push({ kind: "fill", ts: f.ts, hook: f.hook?.id ?? null, txHash: hex(f.txHash), text: `Fill via Pool ${poolName(f.pool.id)}: quoted ${n18(f.quotedOut)}, delivered ${n18(f.settledOut)}` });
  for (const s of d.Strike)
    out.push({
      kind: "strike",
      ts: s.ts,
      hook: s.hook?.id ?? null,
      txHash: hex(s.txHash),
      text: s.execFailed ? `STRIKE on Pool ${poolName(s.pool.id)}: the swap failed after a good quote` : `STRIKE on Pool ${poolName(s.pool.id)}: quoted ${n18(s.quotedOut)}, delivered ${n18(s.settledOut)} (-${(s.shortfallBps / 100).toFixed(1)}%)`,
    });
  for (const p of d.Probe) out.push({ kind: "probe", ts: p.ts, hook: p.hook?.id ?? null, txHash: hex(p.txHash), text: `Canary probe: ${p.strike ? `STRUCK (-${(p.shortfallBps / 100).toFixed(1)}%)` : "clean"}` });
  for (const c of d.StatusChange) out.push({ kind: "status", ts: c.ts, hook: c.hook?.id ?? null, txHash: null, text: `Status ${c.oldStatus} -> ${c.newStatus} (${c.reason})` });
  for (const k of d.Skip) out.push({ kind: "skip", ts: k.ts, hook: k.hook?.id ?? null, txHash: hex(k.txHash), text: `Leg ${SKIP[k.reason] ?? `reason ${k.reason}`}` });
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** BigInt string with 18 decimals to one decimal, rounded to nearest. Exact integer math. */
function n18(v: string): string {
  const x = BigInt(v);
  const scaled = (x + 5n * 10n ** 16n) / 10n ** 17n;
  return `${scaled / 10n}.${scaled % 10n}`;
}
