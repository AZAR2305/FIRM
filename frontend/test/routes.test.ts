import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { planRoute, toCalldataRoutes, MAX_LEGS, type Candidate } from "@/lib/routes";

const E18 = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const hookAddr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;

function cand(name: string, quote: bigint | null, over: Partial<Candidate> = {}, hook = hookAddr(1)): Candidate {
  return {
    name,
    description: `pool ${name}`,
    poolId: `0x${name.charCodeAt(0).toString(16).padStart(64, "0")}` as Hex,
    key: { currency0: hookAddr(10), currency1: hookAddr(11), fee: 500, tickSpacing: 60, hooks: hook },
    status: "UNRATED",
    toleranceBps: 10,
    quotedOut: quote,
    ...over,
  };
}

describe("planRoute (same rules as quote-api)", () => {
  it("orders the headline demo B, C, A by quote", () => {
    const plan = planRoute(
      [cand("A", 997_5n * E18 / 10n, { status: "NORMAL" }, ZERO), cand("C", 998_2n * E18 / 10n, {}, hookAddr(2)), cand("B", 999_0n * E18 / 10n, {}, hookAddr(3))],
      1000n * E18,
      10_000n * E18,
    );
    expect(plan.routes.map((r) => r.name)).toEqual(["B", "C", "A"]);
    expect(plan.skipped).toEqual([]);
  });

  it("drops BLOCKED hooks, UNRATED hooks above the cap, and failed quotes, each with its reason", () => {
    const plan = planRoute(
      [
        cand("B", 999n * E18, { status: "BLOCKED" }, hookAddr(3)),
        cand("U", 998n * E18, { status: "UNRATED" }, hookAddr(4)),
        cand("F", null, { status: "NORMAL" }, hookAddr(5)),
        cand("Z", 0n, { status: "NORMAL" }, hookAddr(6)),
        cand("N", 997n * E18, { status: "NORMAL" }, hookAddr(7)),
      ],
      1000n * E18,
      100n * E18,
    );
    expect(plan.routes.map((r) => r.name)).toEqual(["N"]);
    const why = Object.fromEntries(plan.skipped.map((s) => [s.name, s.reason]));
    expect(why).toEqual({ B: "BLOCKED", U: "UNRATED_CAP", F: "QUOTE_FAILED", Z: "QUOTE_FAILED" });
  });

  it("an UNRATED hook is allowed at or below the cap, and a hookless pool is never capped", () => {
    const at = planRoute([cand("U", 998n * E18, { status: "UNRATED" }, hookAddr(4))], 100n * E18, 100n * E18);
    expect(at.routes.map((r) => r.name)).toEqual(["U"]);
    const hookless = planRoute([cand("A", 997n * E18, { status: "UNRATED" }, ZERO)], 5000n * E18, 100n * E18);
    expect(hookless.routes.map((r) => r.name)).toEqual(["A"]);
  });

  it("keeps at most MAX_LEGS (4) routes and reports the rest as not tried", () => {
    const many = ["A", "B", "C", "D", "E", "F"].map((n, i) => cand(n, BigInt(1000 - i) * E18, { status: "NORMAL" }, hookAddr(20 + i)));
    const plan = planRoute(many, E18, 10n * E18);
    expect(plan.routes).toHaveLength(MAX_LEGS);
    expect(plan.routes.map((r) => r.name)).toEqual(["A", "B", "C", "D"]);
    expect(plan.skipped.map((s) => [s.name, s.reason])).toEqual([["E", "NOT_IN_TOP_LEGS"], ["F", "NOT_IN_TOP_LEGS"]]);
  });

  it("computes the floor from the status tolerance and breaks ties by pool id", () => {
    const plan = planRoute(
      [cand("X", 1000n * E18, { status: "NORMAL", toleranceBps: 10 }, hookAddr(8)), cand("Y", 1000n * E18, { status: "WATCH", toleranceBps: 2 }, hookAddr(9))],
      E18,
      10n * E18,
    );
    expect(plan.routes[0]!.floor).toBe((1000n * E18 * 9990n) / 10_000n);
    expect(plan.routes[0]!.poolId < plan.routes[1]!.poolId).toBe(true);
  });

  it("passes the off-chain quote on as advertisedOut and keeps the direction", () => {
    const plan = planRoute([cand("B", 999n * E18, { status: "NORMAL" }, hookAddr(3))], E18, 10n * E18);
    const calldata = toCalldataRoutes(plan.routes, true);
    expect(calldata[0]).toMatchObject({ zeroForOne: true, hookData: "0x", advertisedOut: 999n * E18 });
  });
});
