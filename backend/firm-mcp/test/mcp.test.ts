import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PublicClient } from "viem";
import type { Deployments } from "@firm/shared";
import { Toolbox, createFirmMcpServer } from "../src";

const T0 = "0x1111111111111111111111111111111111111111";
const T1 = "0x2222222222222222222222222222222222222222";
const HOOK = "0x00000000000000000000000000000000000000b4";
const pid = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const E18 = 10n ** 18n;

const key = (hook: string, fee: number) => ({ currency0: T0, currency1: T1, fee, tickSpacing: 60, hooks: hook });
const routes = [
  { poolId: pid(2), description: "B", zeroForOne: true, quotedOut: (999n * E18).toString(), status: "NORMAL", toleranceBps: 10, floor: (998n * E18).toString(), key: key(HOOK, 1000) },
  { poolId: pid(1), description: "A", zeroForOne: true, quotedOut: (997n * E18).toString(), status: "NORMAL", toleranceBps: 10, floor: (996n * E18).toString(), key: key("0x0000000000000000000000000000000000000000", 2500) },
];

const calls: { url: string; body?: unknown }[] = [];
const fetchFn = (async (url: string, init?: RequestInit) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  if (url.includes("/pools")) return json({ pools: routes.map((r) => ({ poolId: r.poolId, description: r.description, key: r.key, liquidity: "5", status: r.status })) });
  if (url.includes("/hooks/")) return json({ hook: HOOK, status: "NORMAL", strikes: 0 });
  if (url.endsWith("/route")) {
    const b = JSON.parse(init!.body as string);
    if (b.amountIn === "13") return json({ error: { code: "BAD_REQUEST", message: "nope" } }, 400);
    return json({ routes, skipped: [{ poolId: pid(9), hook: HOOK, reason: "BLOCKED" }], calldataRoutes: routes.map((r) => ({ key: r.key, zeroForOne: true, hookData: "0x", advertisedOut: r.quotedOut })) });
  }
  return json({}, 404);
}) as unknown as typeof fetch;

const client = { readContract: async ({ functionName }: { functionName: string }) => (functionName === "decimals" ? 18 : 0n) } as unknown as PublicClient;
const dep = { core: { firmRouter: { address: T0 }, rawRouter: { address: T0 } } } as unknown as Deployments;

async function connect(enableRawSwap = false) {
  const box = new Toolbox({ quoteApiUrl: "http://api", client, dep, fetchFn });
  const server = createFirmMcpServer(box, { enableRawSwap });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(a);
  return c;
}

const textOf = (r: any) => r.content[0].text as string;

describe("firm-mcp", () => {
  it("exposes the four protected tools and NOT raw_swap by default", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["firm_swap", "get_hook_score", "list_pools", "quote"]);
    const swap = tools.find((t) => t.name === "firm_swap")!;
    expect(swap.description).toMatch(/struck/);
    expect(JSON.stringify(swap.inputSchema)).toContain("minOut");
  });

  it("registers raw_swap only when enabled, and labels it unprotected", async () => {
    const { tools } = await (await connect(true)).listTools();
    const raw = tools.find((t) => t.name === "raw_swap")!;
    expect(raw).toBeDefined();
    expect(raw.description).toMatch(/UNPROTECTED/);
  });

  it("list_pools returns pools with hook and rating", async () => {
    const c = await connect();
    const r = JSON.parse(textOf(await c.callTool({ name: "list_pools", arguments: { tokenIn: T0, tokenOut: T1 } })));
    expect(r.pools).toHaveLength(2);
    expect(r.pools[0]).toMatchObject({ description: "B", hook: HOOK, hookStatus: "NORMAL", hasLiquidity: true });
    expect(r.pools[1].hook).toBeNull();
  });

  it("quote humanises amounts and lists skipped pools", async () => {
    const c = await connect();
    const r = JSON.parse(textOf(await c.callTool({ name: "quote", arguments: { tokenIn: T0, tokenOut: T1, amount: "1000" } })));
    expect(r.routes[0]).toMatchObject({ rank: 1, description: "B", quotedOut: "999", floor: "998" });
    expect(r.skipped).toEqual([{ poolId: pid(9), reason: "BLOCKED" }]);
    expect(calls.at(-1)!.body).toMatchObject({ amountIn: (1000n * E18).toString() });
  });

  it("get_hook_score proxies the hook record", async () => {
    const c = await connect();
    const r = JSON.parse(textOf(await c.callTool({ name: "get_hook_score", arguments: { hook: HOOK } })));
    expect(r).toMatchObject({ status: "NORMAL", strikes: 0 });
  });

  it("returns model-safe errors instead of throwing", async () => {
    const c = await connect();
    const bad = await c.callTool({ name: "quote", arguments: { tokenIn: "nope", tokenOut: T1, amount: "1" } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("not a valid address");

    const bad2 = await c.callTool({ name: "quote", arguments: { tokenIn: T0, tokenOut: T1, amount: "-5" } });
    expect(bad2.isError).toBe(true);
    expect(textOf(bad2)).toContain("positive decimal");

    const bad3 = await c.callTool({ name: "quote", arguments: { tokenIn: T0, tokenOut: T1, amount: "0.000000000000000013" } });
    expect(bad3.isError).toBe(true);
    expect(textOf(bad3)).toContain("quote-api 400: nope");
  });

  it("swaps need a wallet: a read-only server refuses", async () => {
    const c = await connect();
    const r = await c.callTool({ name: "firm_swap", arguments: { tokenIn: T0, tokenOut: T1, amount: "1" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("no wallet configured");
  });
});
