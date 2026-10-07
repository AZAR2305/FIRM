import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger, type HookStatsT, type StatusName } from "@firm/shared";
import type { Address, Hex } from "viem";
import { CanaryAgent, defaultOptions, probeMatrix } from "../src/agent";
import type { PoolRecord } from "../src/discover";
import type { ProbeExecutor, ProbeResult } from "../src/prober";
import { analyzeBytecode } from "../src/staticAnalysis";
import { sanitizeLlmText, templateReport, buildGrid, type Evidence } from "../src/report";
import { Store } from "../src/store";
import { llmSummary } from "../src/llm";

const E18 = 10n ** 18n;
const log = createLogger("test");
const hook = "0x00000000000000000000000000000000000000c4" as Address;
const pool: PoolRecord = {
  poolId: ("0x" + "ab".repeat(32)) as Hex,
  key: {
    currency0: "0x1111111111111111111111111111111111111111",
    currency1: "0x2222222222222222222222222222222222222222",
    fee: 500,
    tickSpacing: 60,
    hooks: hook,
  },
};

const tmp = () => mkdtempSync(join(tmpdir(), "canary-"));

class FakeExec implements ProbeExecutor {
  calls: { zeroForOne: boolean; amountIn: bigint; senderIdx: number }[] = [];
  funded = 0;
  constructor(private readonly shortfall: (senderIdx: number) => bigint = () => 0n) {}
  async ensureFunding() {
    this.funded++;
  }
  async probe(route: { zeroForOne: boolean }, amountIn: bigint, senderIdx: number): Promise<ProbeResult> {
    this.calls.push({ zeroForOne: route.zeroForOne, amountIn, senderIdx });
    const s = this.shortfall(senderIdx);
    const quoted = amountIn;
    const settled = quoted - (quoted * s) / 10_000n;
    return {
      txHash: ("0x" + this.calls.length.toString(16).padStart(64, "0")) as Hex,
      blockNumber: BigInt(this.calls.length),
      probeSender: ("0x" + (senderIdx + 1).toString(16).padStart(40, "0")) as Address,
      quotedOut: quoted,
      settledOut: settled,
      shortfallBps: s,
    };
  }
}

const stats = (status: StatusName): HookStatsT => ({
  fills: 0, strikes: 0, probes: 0, probeStrikes: 0, cleanProbes: 0, cleanStreak: 0, recentStrikes: 0,
  cleanProbeSenders: 0, windowStart: 0n, lastStrikeAt: 0n, firstSeenAt: 0n, cumShortfallBps: 0n, status,
});

function makeAgent(exec: FakeExec, dir: string, opts: Partial<ReturnType<typeof defaultOptions>> = {}, status: () => StatusName = () => "UNRATED") {
  let now = 1_000_000;
  const store = new Store(join(dir, "state.json"));
  const agent = new CanaryAgent(
    { exec, store, log, now: () => now, hookInfo: async () => ({ stats: stats(status()), bytecode: "0x6042" }) },
    { ...defaultOptions(join(dir, "reports")), ...opts },
  );
  return { agent, store, advance: (s: number) => (now += s) };
}

describe("probe matrix", () => {
  it("is amounts {1,10,100} x senders {0..3} x both directions = 24", () => {
    const m = probeMatrix(defaultOptions("x"));
    expect(m).toHaveLength(24);
    expect(new Set(m.map((c) => c.senderIdx))).toEqual(new Set([0, 1, 2, 3]));
    expect(new Set(m.map((c) => c.amountIn))).toEqual(new Set([1n * E18, 10n * E18, 100n * E18]));
    expect(m.filter((c) => c.zeroForOne)).toHaveLength(12);
  });
});

describe("CanaryAgent", () => {
  it("probes the whole matrix once, then never again until the re-probe interval", async () => {
    const dir = tmp();
    const exec = new FakeExec();
    const { agent, advance } = makeAgent(exec, dir);
    const first = await agent.runOnce([pool]);
    expect(first.probesSent).toBe(24);
    expect(exec.funded).toBe(1);

    const second = await agent.runOnce([pool]);
    expect(second.probesSent).toBe(0);
    expect(exec.calls).toHaveLength(24);

    advance(6 * 3600 + 1);
    const third = await agent.runOnce([pool]);
    expect(third.probesSent).toBe(24);
    expect(exec.calls).toHaveLength(48);
  });

  it("restarts do not double-probe (state survives a new process)", async () => {
    const dir = tmp();
    const exec = new FakeExec();
    await makeAgent(exec, dir).agent.runOnce([pool]);
    const exec2 = new FakeExec();
    const again = await makeAgent(exec2, dir).agent.runOnce([pool]);
    expect(again.probesSent).toBe(0);
    expect(exec2.calls).toHaveLength(0);
  });

  it("resumes a half-finished round after a crash", async () => {
    const dir = tmp();
    let n = 0;
    const flaky = new FakeExec();
    const orig = flaky.probe.bind(flaky);
    flaky.probe = async (...a) => {
      if (++n === 10) throw new Error("rpc died");
      return orig(...a);
    };
    await expect(makeAgent(flaky, dir).agent.runOnce([pool])).rejects.toThrow("rpc died");
    const exec2 = new FakeExec();
    const resumed = await makeAgent(exec2, dir).agent.runOnce([pool]);
    expect(resumed.probesSent).toBe(24 - 9);
  });

  it("stops early once the hook is BLOCKED", async () => {
    const dir = tmp();
    const exec = new FakeExec(() => 1800n);
    let blocked = false;
    const origProbe = exec.probe.bind(exec);
    exec.probe = async (...a) => {
      const r = await origProbe(...a);
      blocked = true; // the Scoreboard blocks after the first severe probe
      return r;
    };
    const { agent } = makeAgent(exec, dir, {}, () => (blocked ? "BLOCKED" : "UNRATED"));
    const r = await agent.runOnce([pool]);
    expect(r.probesSent).toBe(1);
  });

  it("can collect the full grid when stopOnBlocked is false", async () => {
    const exec = new FakeExec(() => 1800n);
    const { agent } = makeAgent(exec, tmp(), { stopOnBlocked: false }, () => "BLOCKED");
    expect((await agent.runOnce([pool])).probesSent).toBe(24);
  });

  it("writes a report file the quote-api can serve", async () => {
    const dir = tmp();
    const exec = new FakeExec((idx) => (idx >= 1 ? 500n : 0n)); // sender-aware: only identity 0 is treated honestly
    const { agent } = makeAgent(exec, dir, { stopOnBlocked: false }, () => "BLOCKED");
    await agent.runOnce([pool]);
    const file = join(dir, "reports", `${hook}.json`);
    expect(existsSync(file)).toBe(true);
    const rep = JSON.parse(readFileSync(file, "utf8"));
    expect(rep.hook).toBe(hook);
    expect(rep.evidence.probeGrid).toHaveLength(24);
    expect(rep.markdown).toContain("Worst probe shortfall: 500 bps");
    expect(rep.markdown).toContain("sender identities: 1, 2, 3");
  });
});

describe("static analysis", () => {
  it("lists risk opcodes", () => {
    // ORIGIN GASPRICE TIMESTAMP PREVRANDAO GAS STOP
    const r = analyzeBytecode("0x323a42445a00");
    expect(r.riskFlags).toEqual(["GAS", "GASPRICE", "ORIGIN", "PREVRANDAO", "TIMESTAMP"]);
    expect(r.counts.ORIGIN).toBe(1);
  });
  it("skips PUSH data so data bytes are not miscounted", () => {
    // PUSH2 0x3242 (looks like ORIGIN, TIMESTAMP) then STOP: no risk flags
    expect(analyzeBytecode("0x61324200").riskFlags).toEqual([]);
    // PUSH32 of 32 x 0x5a then a real GAS
    expect(analyzeBytecode(("0x7f" + "5a".repeat(32) + "5a") as `0x${string}`).counts).toEqual({ GAS: 1 });
  });
  it("handles a truncated PUSH at the end of code", () => {
    expect(analyzeBytecode("0x7f5a").riskFlags).toEqual([]);
  });
  it("rejects invalid hex", () => {
    expect(() => analyzeBytecode("0xzz")).toThrow();
    expect(() => analyzeBytecode("0xabc")).toThrow();
  });
  it("empty code has no flags", () => {
    expect(analyzeBytecode("0x").riskFlags).toEqual([]);
  });
});

describe("reports", () => {
  const ev = (cells: Evidence["probeGrid"]): Evidence => ({
    hook,
    generatedAt: "t",
    status: "NORMAL",
    flags: ["AFTER_SWAP", "AFTER_SWAP_RETURNS_DELTA"],
    canChangeSwapAmounts: true,
    riskFlags: [],
    stats: { fills: 3, strikes: 0, probes: 6, probeStrikes: 0, cleanProbes: 6, cleanProbeSenders: 3 },
    probeGrid: cells,
  });
  it("template: clean hook", () => {
    const md = templateReport(
      ev([{ zeroForOne: true, amountIn: "1", senderIdx: 0, quotedOut: "1", settledOut: "1", shortfallBps: "0", txHash: "0x1" }]),
    );
    expect(md).toContain("**Status: NORMAL.**");
    expect(md).toContain("worst shortfall 0 bps");
    expect(md).toContain("can change swap amounts");
  });
  it("template: no probes yet", () => {
    expect(templateReport(ev([]))).toContain("No probes recorded yet");
  });
  it("sanitises LLM output", () => {
    expect(sanitizeLlmText("<script>alert(1)</script>Hello\u0000 world\n\n\n\nok")).toBe("alert(1)Hello world\n\nok");
    expect(sanitizeLlmText("x".repeat(5000)).length).toBe(1500);
  });
  it("grid is ordered for the UI: zeroForOne first, then sender, then amount", () => {
    const g = buildGrid([
      { poolId: "0x", hook, zeroForOne: false, amountIn: "1", senderIdx: 0, probeSender: hook, quotedOut: "1", settledOut: "1", shortfallBps: "0", txHash: "0xa", blockNumber: "1", ts: 1, round: 0 },
      { poolId: "0x", hook, zeroForOne: true, amountIn: "10", senderIdx: 1, probeSender: hook, quotedOut: "1", settledOut: "1", shortfallBps: "0", txHash: "0xb", blockNumber: "1", ts: 1, round: 0 },
      { poolId: "0x", hook, zeroForOne: true, amountIn: "1", senderIdx: 1, probeSender: hook, quotedOut: "1", settledOut: "1", shortfallBps: "0", txHash: "0xc", blockNumber: "1", ts: 1, round: 0 },
    ]);
    expect(g.map((c) => c.txHash)).toEqual(["0xc", "0xb", "0xa"]);
  });
});

describe("llm summary (advisory)", () => {
  const cfg = { baseUrl: "http://llm", apiKey: "k", model: "m" };
  const evidence = {} as Evidence;
  it("returns sanitised text", async () => {
    const f = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "<b>Fine</b> hook" } }] }))) as typeof fetch;
    expect(await llmSummary(cfg, evidence, f)).toBe("Fine hook");
  });
  it("returns null on any failure so the template is used (F6)", async () => {
    expect(await llmSummary(cfg, evidence, (async () => new Response("no", { status: 500 })) as typeof fetch)).toBeNull();
    expect(await llmSummary(cfg, evidence, (async () => { throw new Error("down"); }) as typeof fetch)).toBeNull();
    expect(await llmSummary(cfg, evidence, (async () => new Response("{}")) as typeof fetch)).toBeNull();
  });
});
