import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PublicClient } from "viem";
import type { Deployments } from "@firm/shared";
import { Toolbox, createFirmMcpServer } from "@firm/firm-mcp";
import { FIRM_TOOLS, RAW_TOOLS, outcomeOf, runArena } from "../src/arena";
import { SYSTEM_PROMPT, runLlmTrader, runScriptedTrader, type LlmConfig } from "../src/llmAgent";
import { McpToolSource, restrict, type ToolResult, type ToolSource } from "../src/toolSource";

const T0 = "0x1111111111111111111111111111111111111111";
const T1 = "0x2222222222222222222222222222222222222222";

const quoteResult = JSON.stringify({
  routes: [
    { rank: 1, poolId: "0xB", description: "B", quotedOut: "999", floor: "998", hookStatus: "UNRATED", toleranceBps: 10 },
    { rank: 2, poolId: "0xC", description: "C", quotedOut: "998.2", floor: "997", hookStatus: "UNRATED", toleranceBps: 10 },
  ],
  skipped: [],
});
const rawResult = JSON.stringify({ txHash: "0xraw", pool: "B", quoted: "999", received: "819.2", shortfallBps: 1799, warning: "UNPROTECTED" });
const firmResult = JSON.stringify({
  txHash: "0xfirm", filled: true, legIndex: 1, received: "998.2", quotedByFilledLeg: "998.2",
  rejectedLegs: [{ poolId: "0xB", quoted: "999", wouldHaveDelivered: "819.2", shortfallBps: 1799 }], skippedLegs: 0, timeline: [],
});

/** canned tool server that records every call */
class FakeSource implements ToolSource {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  async tools() {
    return ["list_pools", "get_hook_score", "quote", "firm_swap", "raw_swap"].map((name) => ({ name, description: `${name} tool`, inputSchema: { type: "object", properties: {} } }));
  }
  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    const text = { list_pools: "{\"pools\":[]}", quote: quoteResult, raw_swap: rawResult, firm_swap: firmResult, get_hook_score: "{}" }[name];
    return text ? { text, isError: false } : { text: `unknown tool ${name}`, isError: true };
  }
  async close() {}
}

describe("restrict", () => {
  it("hides and blocks tools the arm may not use", async () => {
    const src = new FakeSource();
    const raw = restrict(src, RAW_TOOLS);
    expect((await raw.tools()).map((t) => t.name)).toEqual(["list_pools", "quote", "raw_swap"]);
    const blocked = await raw.call("firm_swap", {});
    expect(blocked.isError).toBe(true);
    expect(src.calls).toHaveLength(0);
    expect((await restrict(src, FIRM_TOOLS).tools()).map((t) => t.name)).toEqual(["list_pools", "quote", "firm_swap"]);
  });
});

describe("scripted trader (fallback F6)", () => {
  it("raw mode trusts the best quote and sends it to raw_swap", async () => {
    const src = new FakeSource();
    const trace = await runScriptedTrader({ source: src, mode: "raw", tokenIn: T0, tokenOut: T1, amount: "1000" });
    expect(trace.mode).toBe("scripted");
    expect(src.calls.map((c) => c.name)).toEqual(["list_pools", "quote", "raw_swap"]);
    expect(src.calls[2]!.args).toMatchObject({ poolId: "0xB", amount: "1000" });
  });
  it("firm mode uses firm_swap", async () => {
    const src = new FakeSource();
    await runScriptedTrader({ source: src, mode: "firm", tokenIn: T0, tokenOut: T1, amount: "5" });
    expect(src.calls.map((c) => c.name)).toEqual(["list_pools", "quote", "firm_swap"]);
  });
});

describe("LLM trader loop", () => {
  const llm: LlmConfig = { baseUrl: "http://llm.test/v1", apiKey: "k", model: "test-model" };
  const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const reply = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }));

  it("runs tools the model asks for, feeds results back, and stops on the final message", async () => {
    const sent: any[] = [];
    let n = 0;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push(body);
      n++;
      if (n === 1) return reply({ role: "assistant", content: null, tool_calls: [call("c1", "quote", { tokenIn: T0, tokenOut: T1, amount: "1000" })] });
      if (n === 2) return reply({ role: "assistant", content: null, tool_calls: [call("c2", "raw_swap", { poolId: "0xB", tokenIn: T0, tokenOut: T1, amount: "1000" })] });
      return reply({ role: "assistant", content: "Done: swapped via pool B." });
    }) as unknown as typeof fetch;

    const src = new FakeSource();
    const trace = await runLlmTrader({ llm, source: restrict(src, RAW_TOOLS), task: "Swap 1000 tUSD", fetchFn });
    expect(trace).toMatchObject({ mode: "llm", turns: 3, stoppedBy: "model", finalText: "Done: swapped via pool B." });
    expect(trace.steps.map((s) => s.tool)).toEqual(["quote", "raw_swap"]);

    // request shape: system prompt, only the allowed tools, tool results fed back
    expect(sent[0].messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(sent[0].tools.map((t: any) => t.function.name)).toEqual(["list_pools", "quote", "raw_swap"]);
    expect(sent[2].messages.filter((m: any) => m.role === "tool")).toHaveLength(2);
    expect(sent[2].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c2" });
  });

  it("a tool the arm does not have comes back as an error the model can read", async () => {
    let n = 0;
    const fetchFn = (async () => (++n === 1 ? reply({ role: "assistant", content: null, tool_calls: [call("c1", "firm_swap", {})] }) : reply({ role: "assistant", content: "ok" }))) as unknown as typeof fetch;
    const trace = await runLlmTrader({ llm, source: restrict(new FakeSource(), RAW_TOOLS), task: "t", fetchFn });
    expect(trace.steps[0]).toMatchObject({ tool: "firm_swap", isError: true });
    expect(trace.steps[0]!.result).toContain("not available");
  });

  it("survives malformed tool arguments and stops at maxSteps", async () => {
    const fetchFn = (async () => reply({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "quote", arguments: "{not json" } }] })) as unknown as typeof fetch;
    const trace = await runLlmTrader({ llm, source: new FakeSource(), task: "t", maxSteps: 3, fetchFn });
    expect(trace.stoppedBy).toBe("max_steps");
    expect(trace.turns).toBe(3);
    expect(trace.steps.every((s) => s.isError)).toBe(true);
  });

  it("a model that never calls a tool is reported as such", async () => {
    const fetchFn = (async () => reply({ role: "assistant", content: "I would rather not." })) as unknown as typeof fetch;
    const trace = await runLlmTrader({ llm, source: new FakeSource(), task: "t", fetchFn });
    expect(trace.stoppedBy).toBe("no_tool_calls");
    expect(outcomeOf(trace).error).toMatch(/never executed/);
  });

  it("surfaces endpoint failures", async () => {
    const fetchFn = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    await expect(runLlmTrader({ llm, source: new FakeSource(), task: "t", fetchFn })).rejects.toThrow("HTTP 429");
  });
});

describe("outcomeOf reads numbers from tool results, never from model prose", () => {
  it("unprotected agent: hidden fee shows as shortfall vs the paying leg's quote", async () => {
    const trace = await runScriptedTrader({ source: new FakeSource(), mode: "raw", tokenIn: T0, tokenOut: T1, amount: "1000" });
    const o = outcomeOf(trace);
    expect(o).toMatchObject({ ok: true, pool: "B", paidLegQuote: "999", received: "819.2", txHash: "0xraw" });
    expect(o.hiddenLossBps).toBe(1799);
    expect(o.costVsBestQuoteBps).toBe(1799);
  });
  it("protected agent: no hidden loss; only the honest pool's slightly worse price remains", async () => {
    const trace = await runScriptedTrader({ source: new FakeSource(), mode: "firm", tokenIn: T0, tokenOut: T1, amount: "1000" });
    const o = outcomeOf(trace);
    expect(o).toMatchObject({ ok: true, received: "998.2", rejectedLegs: 1 });
    expect(o.hiddenLossBps).toBe(0);
    expect(o.costVsBestQuoteBps).toBe(8); // (999 - 998.2) / 999 = 8 bps
  });
});

describe("runArena", () => {
  it("runs both arms per trade, calls beforeTrial each time and totals the losses", async () => {
    const src = new FakeSource();
    const before: number[] = [];
    const r = await runArena({ source: src, llm: null, tokenIn: T0, tokenOut: T1, amounts: ["100", "200", "300"], beforeTrial: async (i) => void before.push(i) });
    expect(before).toEqual([0, 1, 2]);
    expect(r.mode).toBe("scripted");
    expect(r.model).toBeNull();
    expect(r.trials).toBe(3);
    // arms are isolated: the raw arm never saw firm_swap and vice versa
    const names = src.calls.map((c) => c.name);
    expect(names.filter((n) => n === "raw_swap")).toHaveLength(3);
    expect(names.filter((n) => n === "firm_swap")).toHaveLength(3);
    expect(r.summary.unprotected).toMatchObject({ filled: 3, meanHiddenLossBps: 1799, totalLossVsPaidQuote: "539.4" }); // 3 x (999 - 819.2)
    expect(r.summary.protected).toMatchObject({ filled: 3, meanHiddenLossBps: 0, totalLossVsPaidQuote: "0" });
  });

  it("records an agent failure instead of crashing the run", async () => {
    const src = new FakeSource();
    const orig = src.call.bind(src);
    src.call = async (n, a) => (n === "raw_swap" ? { text: "boom", isError: true } : orig(n, a));
    const r = await runArena({ source: src, llm: null, tokenIn: T0, tokenOut: T1, amounts: ["100"] });
    expect(r.runs[0]!.unprotected).toMatchObject({ ok: false, error: "boom" });
    expect(r.runs[0]!.protected.ok).toBe(true);
    expect(r.summary.unprotected.filled).toBe(0);
  });
});

describe("end to end over the real MCP protocol (firm-mcp server <-> McpToolSource)", () => {
  it("lists the server's tools with their JSON schemas and runs a read-only tool", async () => {
    const routes = [{ poolId: "0x" + "02".padStart(64, "0"), description: "B", zeroForOne: true, quotedOut: (999n * 10n ** 18n).toString(), status: "NORMAL", toleranceBps: 10, floor: (998n * 10n ** 18n).toString(), key: { currency0: T0, currency1: T1, fee: 1000, tickSpacing: 60, hooks: "0x00000000000000000000000000000000000000b4" } }];
    const fetchFn = (async (url: string) => new Response(JSON.stringify(url.includes("/pools") ? { pools: routes.map((r) => ({ poolId: r.poolId, description: r.description, key: r.key, liquidity: "1", status: r.status })) } : { routes, skipped: [], calldataRoutes: routes.map((r) => ({ key: r.key, zeroForOne: true, hookData: "0x", advertisedOut: r.quotedOut })) }))) as unknown as typeof fetch;
    const client = { readContract: async ({ functionName }: { functionName: string }) => (functionName === "decimals" ? 18 : 0n) } as unknown as PublicClient;
    const server = createFirmMcpServer(new Toolbox({ quoteApiUrl: "http://api", client, dep: {} as Deployments, fetchFn }), { enableRawSwap: true });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);

    const source = new McpToolSource(a);
    const tools = await source.tools();
    expect(tools.map((t) => t.name).sort()).toEqual(["firm_swap", "get_hook_score", "list_pools", "quote", "raw_swap"]);
    expect((tools.find((t) => t.name === "quote")!.inputSchema as any).required).toEqual(["tokenIn", "tokenOut", "amount"]);

    const r = await restrict(source, FIRM_TOOLS).call("quote", { tokenIn: T0, tokenOut: T1, amount: "1000" });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).routes[0].quotedOut).toBe("999");
    await source.close();
  });
});
