import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { RPC_URL } from "@/lib/config";
import { deployments, ZERO_ADDRESS } from "@/lib/deployments";
import { deterministicReport, llmConfigFromEnv, llmReport, type HookFacts, type HookReport } from "@/lib/report";
import { statusName } from "@/lib/status";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; report: HookReport; facts: HookFacts }>();
const TTL_MS = 20_000;

/**
 * GET /api/hook-report?hook=0x...  A short, plain-English report about one tracked hook. Facts come from the Scoreboard contract. The text is a
 * deterministic template; if LLM_BASE_URL, LLM_API_KEY and LLM_MODEL are set on the server (never exposed to the browser), a language model
 * rewrites it, and the response says so. The model never decides anything and never sees anything but those facts.
 */
export async function GET(req: Request) {
  const hook = new URL(req.url).searchParams.get("hook") ?? "";
  if (!isAddress(hook)) return NextResponse.json({ error: "hook must be an address" }, { status: 400 });
  const d = deployments;
  if (!d) return NextResponse.json({ error: "FIRM is not deployed" }, { status: 503 });
  const entry = Object.entries(d.pools.list).find(([, p]) => p.hook.toLowerCase() === hook.toLowerCase() && p.hook.toLowerCase() !== ZERO_ADDRESS);
  if (!entry) return NextResponse.json({ error: "not a hook of the seeded pools" }, { status: 404 });

  const key = hook.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ ...hit.report, facts: hit.facts, cached: true });

  try {
    const client = createPublicClient({ transport: http(RPC_URL) });
    const [s, tol] = await Promise.all([
      client.readContract({ address: d.core.scoreboard.address, abi: d.abis.Scoreboard, functionName: "stats", args: [entry[1].hook] }) as Promise<{
        fills: number; strikes: number; probes: number; probeStrikes: number; lastStrikeAt: bigint; cumShortfallBps: bigint; status: number;
      }>,
      client.readContract({ address: d.core.scoreboard.address, abi: d.abis.Scoreboard, functionName: "toleranceBps", args: [entry[1].hook] }) as Promise<number>,
    ]);
    const facts: HookFacts = {
      pool: entry[0],
      description: entry[1].description,
      hook: entry[1].hook,
      status: statusName(s.status),
      fills: Number(s.fills),
      strikes: Number(s.strikes),
      probes: Number(s.probes),
      probeStrikes: Number(s.probeStrikes),
      avgShortfallBps: s.strikes > 0 ? Number(s.cumShortfallBps) / Number(s.strikes) : null,
      lastStrikeAt: Number(s.lastStrikeAt),
      toleranceBps: Number(tol),
    };
    const base = deterministicReport(facts);
    const cfg = llmConfigFromEnv();
    const report: HookReport = cfg ? await llmReport(facts, base, cfg) : { mode: "deterministic", text: base };
    cache.set(key, { at: Date.now(), report, facts });
    return NextResponse.json({ ...report, facts });
  } catch (e) {
    return NextResponse.json({ error: `could not read the Scoreboard: ${(e as Error).message}` }, { status: 502 });
  }
}
