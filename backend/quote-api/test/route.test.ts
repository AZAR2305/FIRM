import { describe, expect, it } from "vitest";
import { computeRoutes } from "../src/route";
import { POOL_A, POOL_B, POOL_C, POOL_D, T0, T1, FakeChain, FakeSource, demoQuotes, E18, hookB, hookC, hookD } from "./fixtures";

const req = { tokenIn: T0, tokenOut: T1, amountIn: 1000n * E18 };
const allPools = new FakeSource([POOL_A, POOL_B, POOL_C, POOL_D]);
const rated = { [hookB.toLowerCase()]: "NORMAL", [hookC.toLowerCase()]: "NORMAL", [hookD.toLowerCase()]: "NORMAL" } as const;

describe("computeRoutes", () => {
  it("orders best quote first: B, C, A, D", async () => {
    const r = await computeRoutes(new FakeChain({ quotes: demoQuotes, status: { ...rated } }), allPools, req);
    expect(r.routes.map((x) => x.poolId)).toEqual([POOL_B.poolId, POOL_C.poolId, POOL_A.poolId, POOL_D.poolId]);
    expect(r.skipped).toEqual([]);
  });

  it("returns the quote as advertisedOut and the floor = quote - tolerance", async () => {
    const r = await computeRoutes(new FakeChain({ quotes: demoQuotes, status: { ...rated } }), allPools, req);
    const b = r.routes[0]!;
    expect(b.advertisedOut).toBe(b.quotedOut);
    expect(b.floor).toBe((b.quotedOut * 9990n) / 10000n);
    expect(r.calldataRoutes[0]).toMatchObject({ zeroForOne: true, hookData: "0x", advertisedOut: b.quotedOut });
  });

  it("drops BLOCKED hooks and lists them under skipped", async () => {
    const r = await computeRoutes(
      new FakeChain({ quotes: demoQuotes, status: { ...rated, [hookB.toLowerCase()]: "BLOCKED" } }),
      allPools,
      req,
    );
    expect(r.routes.map((x) => x.poolId)).toEqual([POOL_C.poolId, POOL_A.poolId, POOL_D.poolId]);
    expect(r.skipped).toEqual([{ poolId: POOL_B.poolId, hook: hookB, reason: "BLOCKED" }]);
  });

  it("drops UNRATED hooks above the cap but keeps hookless and rated pools", async () => {
    const r = await computeRoutes(new FakeChain({ quotes: demoQuotes, status: { [hookC.toLowerCase()]: "NORMAL" } }), allPools, req);
    // B and D are UNRATED (default) and 1000 > 100 cap
    expect(r.routes.map((x) => x.poolId)).toEqual([POOL_C.poolId, POOL_A.poolId]);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(["UNRATED_CAP", "UNRATED_CAP"]);
  });

  it("allows UNRATED hooks under the cap", async () => {
    const r = await computeRoutes(new FakeChain({ quotes: demoQuotes }), allPools, { ...req, amountIn: 50n * E18 });
    expect(r.routes).toHaveLength(4);
  });

  it("drops pools with zero liquidity", async () => {
    const r = await computeRoutes(
      new FakeChain({ quotes: demoQuotes, status: { ...rated }, liquidity: { [POOL_A.poolId]: 0n } }),
      allPools,
      req,
    );
    expect(r.skipped).toContainEqual({ poolId: POOL_A.poolId, hook: "0x0000000000000000000000000000000000000000", reason: "NO_LIQUIDITY" });
    expect(r.routes.map((x) => x.poolId)).not.toContain(POOL_A.poolId);
  });

  it("discards failed quotes", async () => {
    const r = await computeRoutes(
      new FakeChain({ quotes: { ...demoQuotes, [POOL_C.poolId]: null }, status: { ...rated } }),
      allPools,
      req,
    );
    expect(r.skipped).toContainEqual({ poolId: POOL_C.poolId, hook: hookC, reason: "QUOTE_FAILED" });
    expect(r.routes.map((x) => x.poolId)).toEqual([POOL_B.poolId, POOL_A.poolId, POOL_D.poolId]);
  });

  it("caps legs at maxLegs and never above the contract MAX_LEGS of 4", async () => {
    const chain = new FakeChain({ quotes: demoQuotes, status: { ...rated } });
    expect((await computeRoutes(chain, allPools, { ...req, maxLegs: 2 })).routes).toHaveLength(2);
    expect((await computeRoutes(chain, allPools, { ...req, maxLegs: 99 })).routes).toHaveLength(4);
  });

  it("breaks quote ties deterministically", async () => {
    const q = { ...demoQuotes, [POOL_C.poolId]: demoQuotes[POOL_B.poolId] };
    const a = await computeRoutes(new FakeChain({ quotes: q, status: { ...rated } }), allPools, req);
    const b = await computeRoutes(new FakeChain({ quotes: q, status: { ...rated } }), new FakeSource([POOL_D, POOL_C, POOL_B, POOL_A]), req);
    expect(a.routes.map((x) => x.poolId)).toEqual(b.routes.map((x) => x.poolId));
  });

  it("direction follows tokenIn", async () => {
    const r = await computeRoutes(new FakeChain({ quotes: demoQuotes, status: { ...rated } }), allPools, { ...req, tokenIn: T1, tokenOut: T0 });
    expect(r.routes.every((x) => x.zeroForOne === false)).toBe(true);
  });
});
