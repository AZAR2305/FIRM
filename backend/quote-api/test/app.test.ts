import { describe, expect, it } from "vitest";
import { createLogger } from "@firm/shared";
import type { PublicClient } from "viem";
import { createApp } from "../src/app";
import { TtlCache } from "../src/cache";
import { POOL_A, POOL_B, POOL_C, T0, T1, FakeChain, FakeSource, demoQuotes, E18, fakeDeployments, hookB, hookC } from "./fixtures";

const log = createLogger("test");

function app(chain = new FakeChain({ quotes: demoQuotes, status: { [hookB.toLowerCase()]: "NORMAL", [hookC.toLowerCase()]: "NORMAL" } })) {
  const a = createApp({
    chain,
    source: new FakeSource([POOL_A, POOL_B, POOL_C]),
    dep: fakeDeployments,
    log,
    reports: async (h) => (h.toLowerCase() === hookB ? { hook: h, createdAt: "t", markdown: "# report", evidence: { x: 1 } } : null),
    client: {} as PublicClient,
  });
  return { a, chain };
}

const post = (a: ReturnType<typeof app>["a"], body: unknown) =>
  a.request("/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("quote-api HTTP", () => {
  it("GET /health", async () => {
    const res = await app().a.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, chainId: 10143, blockNumber: "123", rpcInUse: "mock" });
  });

  it("POST /route returns ordered routes with bigint amounts as strings", async () => {
    const res = await post(app().a, { tokenIn: T0, tokenOut: T1, amountIn: (1000n * E18).toString() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.routes.map((r: any) => r.poolId)).toEqual([POOL_B.poolId, POOL_C.poolId, POOL_A.poolId]);
    expect(body.routes[0].quotedOut).toBe("999000000000000000000");
    expect(body.naivePick).toBe(POOL_B.poolId);
    expect(body.preview).toBeNull();
    expect(body.calldataRoutes[0].advertisedOut).toBe("999000000000000000000");
  });

  it("POST /route with a wallet adds the protected-vs-raw preview", async () => {
    const res = await post(app().a, {
      tokenIn: T0,
      tokenOut: T1,
      amountIn: "1000",
      wallet: "0x00000000000000000000000000000000000000aa",
    });
    const body = (await res.json()) as any;
    expect(body.preview).toEqual({ naiveOut: "819", firmOut: "998", firmLegIndex: 1 });
  });

  it("rejects bad input with a typed 400", async () => {
    const a = app().a;
    for (const body of [
      { tokenIn: "nope", tokenOut: T1, amountIn: "1" },
      { tokenIn: T0, tokenOut: T1, amountIn: "-5" },
      { tokenIn: T0, tokenOut: T1, amountIn: "0" },
      { tokenIn: T0, tokenOut: T1, amountIn: "1.5" },
      { tokenIn: T0, tokenOut: T0, amountIn: "1" },
      { tokenIn: T0, tokenOut: T1, amountIn: "1", maxLegs: 9 },
    ]) {
      const res = await post(a, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("BAD_REQUEST");
    }
    const res = await a.request("/route", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  it("dedupes and caches identical concurrent requests", async () => {
    const { a, chain } = app();
    const body = { tokenIn: T0, tokenOut: T1, amountIn: "1000000000000000000000" };
    await Promise.all([post(a, body), post(a, body), post(a, body)]);
    expect(chain.quoteCalls).toBe(1);
  });

  it("GET /pools lists pools with status and liquidity", async () => {
    const res = await app().a.request(`/pools?tokenIn=${T0}&tokenOut=${T1}`);
    const body = (await res.json()) as any;
    expect(body.pools).toHaveLength(3);
    expect(body.pools[0]).toMatchObject({ liquidity: "1" });
  });

  it("GET /hooks/:addr/report serves the report, 404 when missing, 400 on a bad address", async () => {
    const a = app().a;
    const ok = await a.request(`/hooks/${hookB}/report`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).markdown).toBe("# report");
    expect((await a.request(`/hooks/${hookC}/report`)).status).toBe(404);
    expect((await a.request(`/hooks/not-an-address/report`)).status).toBe(400);
  });
});

describe("TtlCache", () => {
  it("expires entries and never caches a failure", async () => {
    const c = new TtlCache(20);
    let n = 0;
    expect(await c.getOrSet("k", async () => ++n)).toBe(1);
    expect(await c.getOrSet("k", async () => ++n)).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(await c.getOrSet("k", async () => ++n)).toBe(2);

    await expect(c.getOrSet("bad", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await c.getOrSet("bad", async () => 7)).toBe(7);
  });
});
