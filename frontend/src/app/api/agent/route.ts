import { NextResponse } from "next/server";
import { MAX_MESSAGE, parseIntentWithRules, validateIntent, type IntentResult } from "@/lib/agentIntent";
import { llmConfigFromEnv } from "@/lib/report";

export const dynamic = "force-dynamic";

const SYSTEM =
  'You read a chat message and extract ONE token swap. Reply with JSON only, no prose: {"amount":"<decimal number as written, without commas>","tokenIn":"tUSD" or "tUSDC","recipient":"<0x address copied from the message>" or null}. ' +
  "Only the tokens tUSD and tUSDC exist. tokenIn is the token the user wants to SELL. If the message gives no swap, reply {}. Never invent a number or an address.";

/** One short window per client so a public page cannot be used to burn the model quota. */
const recent = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

function allowed(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return false;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 500) for (const [k, v] of recent) if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
  return true;
}

/**
 * POST /api/agent { message }. The model (if configured on the server) proposes a swap order from free text; lib/agentIntent.ts accepts it only if
 * the amount and recipient really appear in the message. With no model, or if it fails, plain rules read the message and the answer says so.
 * Nothing here signs or sends anything.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
  if (message.length > MAX_MESSAGE) return NextResponse.json({ error: `message must be at most ${MAX_MESSAGE} characters` }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowed(ip)) return NextResponse.json({ error: "Too many requests. Wait a minute." }, { status: 429 });

  const cfg = llmConfigFromEnv();
  let result: IntentResult | null = null;
  let parser: { kind: "llm"; model: string } | { kind: "rules"; note?: string } = { kind: "rules" };

  if (cfg) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: 120,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: message }],
        }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`model endpoint answered HTTP ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string };
      const proposed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as { amount?: unknown; tokenIn?: unknown; recipient?: unknown };
      result = validateIntent(message, proposed);
      parser = { kind: "llm", model: json.model ?? cfg.model };
    } catch (e) {
      parser = { kind: "rules", note: `The model was not used: ${(e as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }
  // the model did not give an acceptable order: try the strict rules before giving up, and say which one answered
  if (!result || !result.ok) {
    const viaRules = parseIntentWithRules(message);
    if (viaRules.ok || !result) {
      result = viaRules;
      if (parser.kind === "llm") parser = { kind: "rules", note: "The model's answer was not usable, so plain rules read your message." };
    }
  }
  return NextResponse.json({ ...result, parser });
}
