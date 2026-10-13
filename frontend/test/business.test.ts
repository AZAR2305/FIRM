import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { canChangeSwapAmounts, decodeHookFlags, describeFlags } from "@/lib/flags";
import { EnvioError, HOOKS_QUERY, META_QUERY, activityQuery, gql, toActivity, type ActivityData } from "@/lib/envio";
import { costMon, headline, overhead, type Evidence } from "@/lib/evidence";
import { DEMO_VILLAINS, freshVillains, routeWithVillain } from "@/lib/demo";
import { MAX_LEGS, planRoute, type Candidate } from "@/lib/routes";
import { deterministicReport, llmConfigFromEnv, llmReport, sanitize, type HookFacts } from "@/lib/report";

const E18 = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";

// real fixture hook addresses from the deployments: the low 14 bits must decode to what the fixtures declare
const HOOK_B = "0x580c0342b2D503a6CB72E04D431c724d0b98C044"; // FixtureContextHook: afterSwap + afterSwapReturnDelta
const HOOK_G = "0x23DA28226a195e701b348e1c56F1A7c16F038080"; // FixtureGasGriefHook: beforeSwap only

describe("hook permission flags", () => {
  it("decodes the low 14 bits of real fixture addresses exactly as their constructors declare", () => {
    expect(decodeHookFlags(HOOK_B)).toEqual(["AFTER_SWAP", "AFTER_SWAP_RETURNS_DELTA"]);
    expect(decodeHookFlags(HOOK_G)).toEqual(["BEFORE_SWAP"]);
    expect(decodeHookFlags(ZERO)).toEqual([]);
  });

  it("flags only hooks that return a swap delta as able to change amounts", () => {
    expect(canChangeSwapAmounts(HOOK_B)).toBe(true);
    expect(canChangeSwapAmounts(HOOK_G)).toBe(false);
    expect(describeFlags(HOOK_B)).toMatch(/change the amount a swap delivers/);
    expect(describeFlags(ZERO)).toMatch(/No permissions/);
  });
});

describe("Envio client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("filters by hook inside the query text (Hasura rejects _eq: null) and cannot be injected into", () => {
    expect(activityQuery()).not.toContain("where");
    const q = activityQuery(HOOK_B);
    expect(q).toContain(`hook_id: {_eq: "${HOOK_B.toLowerCase()}"}`);
    const evil = activityQuery('0xabc"}) { id } } #');
    expect(evil).not.toContain('"}) { id }');
    expect(evil).not.toContain("#");
  });

  it("asks for the lag separately, so a hosted endpoint without chain_metadata cannot break the leaderboard", () => {
    expect(HOOKS_QUERY).not.toContain("chain_metadata");
    expect(META_QUERY).toContain("chain_metadata");
  });

  it("merges the five event tables newest first with deterministic text, and caps the list", () => {
    const names = (id: string) => (id === "p1" ? "B" : "C");
    const d: ActivityData = {
      Fill: [{ id: "f", ts: 30, txHash: "0xf1", hook: { id: "0xc" }, pool: { id: "p2" }, quotedOut: (998_2n * E18 / 10n).toString(), settledOut: (998_2n * E18 / 10n).toString(), legIndex: 1 }],
      Strike: [{ id: "s", ts: 20, txHash: "0xs1", hook: { id: "0xb" }, pool: { id: "p1" }, quotedOut: (999n * E18).toString(), settledOut: (8192n * E18 / 10n).toString(), shortfallBps: 1799, execFailed: false }],
      Probe: [],
      StatusChange: [{ id: "c", ts: 21, hook: { id: "0xb" }, oldStatus: "UNRATED", newStatus: "BLOCKED", reason: "SEVERE_SHORTFALL" }],
      Skip: [{ id: "k", ts: 10, txHash: "0xk1", hook: { id: "0xb" }, reason: 0 }],
    };
    const a = toActivity(d, names);
    expect(a.map((x) => x.kind)).toEqual(["fill", "status", "strike", "skip"]);
    expect(a[2]!.text).toBe("STRIKE on Pool B: quoted 999.0, delivered 819.2 (-18.0%)");
    expect(a[1]!.text).toBe("Status UNRATED -> BLOCKED (SEVERE_SHORTFALL)");
    expect(a[1]!.txHash).toBeNull();
    expect(toActivity(d, names, 2)).toHaveLength(2);
  });

  it("turns HTTP errors, GraphQL errors, empty data and timeouts into one EnvioError each (MOCKED fetch, tests only)", async () => {
    const mock = (impl: () => Promise<unknown>) => vi.stubGlobal("fetch", vi.fn(impl));
    mock(async () => ({ ok: false, status: 502 }));
    await expect(gql("{x}", {}, "http://e")).rejects.toThrow("HTTP 502");
    mock(async () => ({ ok: true, json: async () => ({ errors: [{ message: "field not found" }] }) }));
    await expect(gql("{x}", {}, "http://e")).rejects.toThrow("field not found");
    mock(async () => ({ ok: true, json: async () => ({}) }));
    await expect(gql("{x}", {}, "http://e")).rejects.toBeInstanceOf(EnvioError);
    mock(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(gql("{x}", {}, "http://e")).rejects.toThrow("unreachable");
    mock(async () => ({ ok: true, json: async () => ({ data: { a: 1 } }) }));
    await expect(gql<{ a: number }>("{x}", {}, "http://e")).resolves.toEqual({ a: 1 });
    await expect(gql("{x}", {}, "")).rejects.toThrow("not set");
  });
});

const ev = (over: Partial<Evidence> = {}): Evidence =>
  ({
    generatedAt: "2026-10-11T00:00:00Z",
    source: "testnet",
    chain: { head: 1, gasPriceWei: "102000000000", gasPriceGwei: 102 },
    txs: [
      { label: "raw", title: "", hash: "0xraw", block: 1, timestamp: 1, status: "success", gasLimit: "1", events: [{ name: "RawSwap", pool: "B", amountIn: (1000n * E18).toString(), amountOut: (819_1792n * E18 / 10_000n).toString() }] },
      {
        label: "firm", title: "", hash: "0xfirm", block: 2, timestamp: 2, status: "success", gasLimit: "1",
        events: [
          // the exact wei values of the real strike on Monad Testnet (block 70,067,053)
          { name: "Rejected", pool: "B", quotedOut: "998997006003979006052", settledOut: "819177544923262784963", execFailed: false },
          { name: "Filled", pool: "C", settledOut: (998_1997n * E18 / 10_000n).toString(), quotedOut: "0" },
        ],
      },
    ],
    gas: { method: "", pools: {}, quotePerCall: {}, demoShape: { note: "", protected: null }, hostileFirst: { note: "", protected: 1 } },
    recorded: {} as Evidence["recorded"],
    ...over,
  }) as Evidence;

describe("evidence", () => {
  it("computes the headline from the decoded events of the two transactions, never from typed numbers", () => {
    const h = headline(ev())!;
    expect(h.rejectedPool).toBe("B");
    expect(h.filledPool).toBe("C");
    expect(h.shortfallBps).toBe(1799);
    expect(h.saved).toBe(h.firmOut - h.rawOut);
    expect(headline(null)).toBeNull();
    expect(headline(ev({ txs: [] }))).toBeNull();
  });

  it("prices a gas limit in MON exactly, rounding up so a cost is never understated", () => {
    expect(costMon(276_219, "102000000000")).toBe("0.0282"); // 0.028174...
    expect(costMon(1_000_000, 100_000_000_000n)).toBe("0.1000");
    expect(costMon(1, 1)).toBe("0.0001");
  });

  it("reports the protected-to-raw ratio", () => {
    expect(overhead(276_219, 397_427)).toBe("1.44");
    expect(overhead(null, 5)).toBeNull();
  });
});

describe("demo villains", () => {
  const cand = (name: string, quote: bigint | null, status: Candidate["status"] = "UNRATED", hook = `0x${name.charCodeAt(0).toString(16).padStart(40, "0")}`): Candidate => ({
    name, description: `pool ${name}`, poolId: `0x${name.charCodeAt(0).toString(16).padStart(64, "0")}` as Hex,
    key: { currency0: "0x1" as Address, currency1: "0x2" as Address, fee: 500, tickSpacing: 60, hooks: hook as Address }, status, toleranceBps: 10, quotedOut: quote,
  });
  const cands = [cand("Q", 1000n * E18), cand("B", 999n * E18), cand("C", 998n * E18), cand("A", 997n * E18, "NORMAL"), cand("D", 996n * E18), cand("G", 994n * E18), cand("R", 993n * E18)];

  it("moves the chosen cheat to the front, keeps the honest order after it and never exceeds MAX_LEGS", () => {
    const plan = planRoute(cands, E18, 10n * E18);
    const r = routeWithVillain(plan, cands, "G")!;
    expect(r[0]!.name).toBe("G");
    expect(r.map((x) => x.name)).toEqual(["G", "Q", "B", "C"]);
    expect(r).toHaveLength(MAX_LEGS);
    expect(routeWithVillain(plan, cands, "B")!.map((x) => x.name)).toEqual(["B", "Q", "C", "A"]);
  });

  it("still places an already-BLOCKED cheat first so the timeline shows the router skipping it", () => {
    const withBlocked = cands.map((c) => (c.name === "B" ? { ...c, status: "BLOCKED" as const } : c));
    const plan = planRoute(withBlocked, E18, 10n * E18);
    const r = routeWithVillain(plan, withBlocked, "B")!;
    expect(r[0]!.name).toBe("B");
    expect(r[0]!.status).toBe("BLOCKED");
  });

  it("returns null for an unquotable cheat and lists only cheats that are not yet BLOCKED", () => {
    const plan = planRoute(cands, E18, 10n * E18);
    expect(routeWithVillain(plan, cands, "Z")).toBeNull();
    expect(routeWithVillain(plan, [cand("G", null)], "G")).toBeNull();
    const state = cands.map((c) => (c.name === "B" ? { ...c, status: "BLOCKED" as const } : c));
    expect(freshVillains(state)).toEqual(["G", "R"]);
    expect(Object.keys(DEMO_VILLAINS)).toEqual(["B", "G", "R"]);
  });
});

describe("hook report", () => {
  const facts: HookFacts = { pool: "B", description: "FixtureContextHook", hook: HOOK_B, status: "BLOCKED", fills: 0, strikes: 1, probes: 0, probeStrikes: 0, avgShortfallBps: 1799, lastStrikeAt: 1_000, toleranceBps: 0 };

  it("is deterministic and uses only the given facts", () => {
    const a = deterministicReport(facts, 1_600);
    expect(a).toBe(deterministicReport(facts, 1_600));
    expect(a).toContain("Pool B's hook is BLOCKED");
    expect(a).toContain("struck 1 time");
    expect(a).toContain("18.0% less than it quoted");
    expect(a).toContain("10 minutes ago");
    expect(deterministicReport(facts, 1_000 + 8 * 3600)).toContain("8 hours ago");
    expect(a).toContain("not investment advice");
  });

  it("treats model output as untrusted text", () => {
    expect(sanitize("<script>alert(1)</script>Hello\u0000 \n world")).toBe("alert(1) Hello world");
    expect(sanitize("x".repeat(2000)).length).toBe(700);
  });

  it("reads the LLM config only when all three variables are set", () => {
    expect(llmConfigFromEnv({ LLM_BASE_URL: "http://x/v1", LLM_API_KEY: "k", LLM_MODEL: "m" })).toEqual({ baseUrl: "http://x/v1", apiKey: "k", model: "m" });
    expect(llmConfigFromEnv({ LLM_BASE_URL: "http://x/v1" })).toBeNull();
  });

  it("uses the model's text when the endpoint answers, and falls back to the deterministic text, saying why, when it does not (MOCKED endpoint, tests only)", async () => {
    const base = deterministicReport(facts, 1_600);
    const cfg = { baseUrl: "http://llm/v1/", apiKey: "k", model: "m1" };
    let seen: { url: string; body: { model: string; messages: { content: string }[] } } | undefined;
    const ok = (async (url: string, init: { body: string }) => {
      seen = { url, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ model: "m1-2026", choices: [{ message: { content: "<b>Pool B was caught delivering less than it quoted.</b> It is blocked." } }] }) };
    }) as unknown as typeof fetch;
    const good = await llmReport(facts, base, cfg, ok);
    expect(good).toMatchObject({ mode: "llm", model: "m1-2026", text: "Pool B was caught delivering less than it quoted. It is blocked." });
    expect(seen!.url).toBe("http://llm/v1/chat/completions");
    expect(seen!.body.messages[1]!.content).toBe(base); // the model is given the facts text and nothing else

    const bad = await llmReport(facts, base, cfg, (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch);
    expect(bad.mode).toBe("deterministic");
    expect(bad.text).toBe(base);
    expect(bad.note).toContain("HTTP 401");
    const empty = await llmReport(facts, base, cfg, (async () => ({ ok: true, json: async () => ({ choices: [] }) })) as unknown as typeof fetch);
    expect(empty.mode).toBe("deterministic");
  });
});
