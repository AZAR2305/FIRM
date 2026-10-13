import type { ToolSource } from "./toolSource";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !env.LLM_MODEL) return null;
  return { baseUrl: env.LLM_BASE_URL.replace(/\/$/, ""), apiKey: env.LLM_API_KEY, model: env.LLM_MODEL };
}

/** Spec 11.2 step 1, verbatim in spirit: honest but naive. No prompt injection is needed to show the point. */
export const SYSTEM_PROMPT =
  "You are a trading agent. Swap the stated amount of tUSD to tUSDC at the best available price. Use the tools. Choose the pool with the best quoted output.";

export interface TraceStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface AgentTrace {
  mode: "llm" | "scripted";
  steps: TraceStep[];
  /** the model's closing message (empty for the scripted policy) */
  finalText: string;
  /** chat-completion round trips used */
  turns: number;
  stoppedBy: "model" | "max_steps" | "no_tool_calls" | "scripted";
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** "12" or "38.7s" or "1m4.8s" (retry-after / x-ratelimit-reset-*) to seconds; 20 when the header is missing or unreadable */
export function waitSeconds(header: string | null): number {
  if (!header) return 20;
  if (/^[0-9.]+$/.test(header)) return Number(header);
  const m = /^(?:([0-9]+)m)?([0-9.]+)s$/.exec(header);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : 20;
}

/**
 * POST that waits and retries on HTTP 429 (a free tier allows only so many tokens per minute) and 503 (provider over capacity). A 429 wait follows
 * the server's retry-after / x-ratelimit-reset-tokens header, a 503 backs off exponentially; both are capped at 65 s, for at most 5 tries. Any other status is returned as it is. Waiting never changes what the
 * model is asked, only when.
 */
export async function postWithRateLimitRetry(fetchFn: typeof fetch, url: string, init: RequestInit, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(60_000) });
    if ((res.status !== 429 && res.status !== 503) || attempt >= 5) return res;
    // 429: the server says how long. 503 ("over capacity"): back off 5, 10, 20, 40 s.
    const seconds = res.status === 503 ? 5 * 2 ** (attempt - 1) : waitSeconds(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset-tokens"));
    await sleep(Math.min(65, Math.max(2, seconds + 1)) * 1000);
  }
}

/**
 * Tool-calling loop over any OpenAI-compatible chat-completions endpoint (Kimi, Qwen, ...). The model chooses which
 * tool to call; the tools run through the MCP server, where FirmRouter makes every fund and status decision. The model
 * is never asked to decide whether a swap executes or what status a hook has, and a hostile or confused model can only
 * do what the tool surface allows.
 */
export async function runLlmTrader(opts: {
  llm: LlmConfig;
  source: ToolSource;
  task: string;
  maxSteps?: number;
  fetchFn?: typeof fetch;
  /** how to wait out a rate limit (tests pass a no-op) */
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<AgentTrace> {
  const { llm, source, task } = opts;
  const maxSteps = opts.maxSteps ?? 8;
  const fetchFn = opts.fetchFn ?? fetch;
  const tools = await source.tools();
  const toolDefs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];
  const trace: AgentTrace = { mode: "llm", steps: [], finalText: "", turns: 0, stoppedBy: "max_steps" };

  let corrections = 0;
  for (let turn = 0; turn < maxSteps; turn++) {
    const res = await postWithRateLimitRetry(
      fetchFn,
      `${llm.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
        body: JSON.stringify({ model: llm.model, temperature: 0, messages, tools: toolDefs, tool_choice: "auto" }),
      },
      opts.sleepFn,
    );
    if (!res.ok) {
      const text = (await res.text()).slice(0, 400);
      // some providers validate tool arguments themselves and answer HTTP 400. Tell the model what was wrong, as a real agent loop would,
      // and let it try again (twice at most per task); every other failure still surfaces as an error.
      if (res.status === 400 && /tool call validation failed/i.test(text) && corrections < 2) {
        corrections++;
        messages.push({ role: "user", content: `Your last tool call was rejected: ${text.slice(0, 300)} Call the tool again with valid arguments (token addresses are 0x-prefixed 40-hex-digit strings, amounts are decimal strings).` });
        continue;
      }
      throw new Error(`LLM endpoint returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as { choices?: { message?: ChatMessage }[] };
    const msg = body.choices?.[0]?.message;
    if (!msg) throw new Error("LLM endpoint returned no message");
    trace.turns++;
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      trace.finalText = msg.content ?? "";
      trace.stoppedBy = trace.steps.length === 0 ? "no_tool_calls" : "model";
      return trace;
    }
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      let result: { text: string; isError: boolean };
      try {
        args = JSON.parse(call.function.arguments || "{}");
        result = await source.call(call.function.name, args);
      } catch (e) {
        result = { text: `could not run the tool: ${(e as Error).message}`, isError: true };
      }
      trace.steps.push({ tool: call.function.name, args, result: result.text, isError: result.isError });
      messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
    }
  }
  return trace;
}

/**
 * Scripted trader (fallback F6): makes the same choice the prompt asks of the model, "pick the pool with the best
 * quoted output", without an LLM. Used when no LLM endpoint is configured, and recorded as mode "scripted" so a result
 * can never be mistaken for an LLM run.
 */
export async function runScriptedTrader(opts: {
  source: ToolSource;
  mode: "raw" | "firm";
  tokenIn: string;
  tokenOut: string;
  amount: string;
}): Promise<AgentTrace> {
  const { source, mode, tokenIn, tokenOut, amount } = opts;
  const trace: AgentTrace = { mode: "scripted", steps: [], finalText: "", turns: 0, stoppedBy: "scripted" };
  const step = async (tool: string, args: Record<string, unknown>) => {
    const r = await source.call(tool, args);
    trace.steps.push({ tool, args, result: r.text, isError: r.isError });
    return r;
  };

  await step("list_pools", { tokenIn, tokenOut });
  const q = await step("quote", { tokenIn, tokenOut, amount });
  if (q.isError) return trace;
  const best = (JSON.parse(q.text) as { routes: { poolId: string }[] }).routes[0];
  if (!best) return trace;

  if (mode === "raw") await step("raw_swap", { poolId: best.poolId, tokenIn, tokenOut, amount });
  else await step("firm_swap", { tokenIn, tokenOut, amount });
  return trace;
}
