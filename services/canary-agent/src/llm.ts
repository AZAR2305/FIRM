import { sanitizeLlmText, type Evidence } from "./report";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !env.LLM_MODEL) return null;
  return { baseUrl: env.LLM_BASE_URL.replace(/\/$/, ""), apiKey: env.LLM_API_KEY, model: env.LLM_MODEL };
}

/**
 * Optional prose summary through any OpenAI-compatible chat-completions endpoint (Kimi, Qwen, ...). The model gets the
 * structured evidence and writes at most ~150 words. It is advisory: it never decides execution, status or parameters
 * (spec 0.1 rule 4), and its output is sanitised and only displayed. Returns null on any failure (fallback F6: the
 * deterministic template report is used instead).
 */
export async function llmSummary(
  cfg: LlmConfig,
  evidence: Evidence,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "You summarise onchain evidence about a Uniswap v4 hook for traders in at most 150 words, plain language. " +
              "Use only the JSON given. Do not give financial advice. Opcode flags are hints, not proof of wrongdoing. Never name a hook as malicious; describe what the probes measured.",
          },
          { role: "user", content: JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (!text) return null;
    const clean = sanitizeLlmText(text);
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}
