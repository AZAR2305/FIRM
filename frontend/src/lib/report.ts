import { canChangeSwapAmounts, decodeHookFlags, describeFlags } from "./flags";

/** The facts a hook report may use. Everything here is read from the Scoreboard contract; the report adds nothing else. */
export interface HookFacts {
  pool: string;
  description: string;
  hook: string;
  status: "UNRATED" | "NORMAL" | "WATCH" | "BLOCKED";
  fills: number;
  strikes: number;
  probes: number;
  probeStrikes: number;
  avgShortfallBps: number | null;
  lastStrikeAt: number;
  toleranceBps: number;
}

export interface HookReport {
  /** "deterministic": a template filled from the facts. "llm": the same facts rewritten by a language model, advisory only. */
  mode: "deterministic" | "llm";
  text: string;
  model?: string;
  /** why the LLM was not used, when it was configured but failed */
  note?: string;
}

const STATUS_MEANING: Record<HookFacts["status"], string> = {
  BLOCKED: "FIRM routers skip it, and any router can read that status from the Scoreboard.",
  WATCH: "it was struck recently, so FIRM accepts only a very small shortfall from it.",
  UNRATED: "there is not enough evidence yet, so FIRM allows it only for small trades.",
  NORMAL: "its quotes have matched its fills so far.",
};

function ago(sec: number): string {
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 120) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}

/** The report with no model involved. Deterministic: the same facts always give the same text. */
export function deterministicReport(f: HookFacts, now = Math.floor(Date.now() / 1000)): string {
  const parts: string[] = [];
  parts.push(`Pool ${f.pool}'s hook is ${f.status}: ${STATUS_MEANING[f.status]}`);
  if (f.strikes > 0) {
    const avg = f.avgShortfallBps == null ? "" : `, delivering on average ${(f.avgShortfallBps / 100).toFixed(1)}% less than it quoted`;
    parts.push(`It has been struck ${f.strikes} time${f.strikes === 1 ? "" : "s"}${avg}${f.lastStrikeAt ? `, most recently ${ago(now - f.lastStrikeAt)}` : ""}.`);
  } else {
    parts.push("It has never been struck.");
  }
  parts.push(`It has ${f.fills} verified fill${f.fills === 1 ? "" : "s"} and ${f.probes} canary probe${f.probes === 1 ? "" : "s"}${f.probeStrikes ? ` (${f.probeStrikes} struck)` : ""}.`);
  const flags = decodeHookFlags(f.hook);
  parts.push(`Permissions: ${flags.length ? flags.join(", ").toLowerCase().replaceAll("_", " ") : "none"}. ${describeFlags(f.hook)}`);
  if (canChangeSwapAmounts(f.hook) && f.status === "UNRATED") parts.push("Because it can change amounts and has no track record, treat quotes through it with care.");
  parts.push("This is evidence about this hook's behaviour towards FIRM and its canary, not a guarantee about every caller, and it is not investment advice.");
  return parts.join(" ");
}

/** Model output is untrusted text: strip tags and control characters, collapse whitespace, cap the length. Never parsed for decisions. */
export function sanitize(text: string, max = 700): string {
  return text
    .replace(/<[^>]*>/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Any OpenAI-compatible chat endpoint (Kimi, Qwen, ...). Rewrites the deterministic report; it is given nothing else and may add nothing. */
export async function llmReport(f: HookFacts, base: string, cfg: LlmConfig, fetchImpl: typeof fetch = fetch): Promise<HookReport> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "You explain on-chain evidence about a Uniswap v4 hook to a trader in plain English, in at most four sentences. Use ONLY the facts you are given. Do not add numbers, names or claims. Do not give investment advice. Keep the caveat that this is evidence about this hook's behaviour towards FIRM, not a guarantee.",
          },
          { role: "user", content: base },
        ],
      }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`LLM endpoint answered HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string };
    const text = sanitize(json.choices?.[0]?.message?.content ?? "");
    if (text.length < 20) throw new Error("LLM returned no usable text");
    return { mode: "llm", text, model: json.model ?? cfg.model };
  } catch (e) {
    return { mode: "deterministic", text: base, note: `LLM not used: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const { LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey, LLM_MODEL: model } = env;
  return baseUrl && apiKey && model ? { baseUrl, apiKey, model } : null;
}
