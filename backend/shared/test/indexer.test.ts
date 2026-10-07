import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAbiItem, toEventSelector, type Abi, type AbiEvent } from "viem";
import {
  CanaryRunnerAbi,
  FirmRouterAbi,
  IPoolManagerAbi,
  ScoreboardAbi,
  decodeHookFlags,
  shortfallBps,
} from "../src";
import { decodeFlags, decodeReason, shortfallBps as idxShortfall } from "../../../envio/src/lib";

const root = join(__dirname, "..", "..", "..");
const yaml = readFileSync(join(root, "envio", "config.yaml"), "utf8");

const abis: Record<string, Abi> = {
  PoolManager: IPoolManagerAbi as Abi,
  Scoreboard: ScoreboardAbi as Abi,
  FirmRouter: FirmRouterAbi as Abi,
  CanaryRunner: CanaryRunnerAbi as Abi,
};

/** contract name -> event signature strings declared in envio/config.yaml */
function configEvents(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current = "";
  for (const line of yaml.split("\n")) {
    const c = line.match(/^\s+- name: (\w+)\s*$/);
    if (c) current = c[1]!;
    const e = line.match(/^\s+- event: (.+)$/);
    if (e && current) (out[current] ??= []).push(e[1]!.trim());
  }
  return out;
}

describe("envio/config.yaml matches the contracts", () => {
  const events = configEvents();

  it("declares the four FIRM contracts plus the PoolManager", () => {
    expect(Object.keys(events).sort()).toEqual(["CanaryRunner", "FirmRouter", "PoolManager", "Scoreboard"]);
  });

  for (const [contract, sigs] of Object.entries(configEvents())) {
    for (const sig of sigs) {
      const name = sig.slice(0, sig.indexOf("("));
      it(`${contract}.${name}: topic0 equals the ABI's`, () => {
        const abiEvent = (abis[contract] as readonly { type: string; name?: string }[]).find(
          (x) => x.type === "event" && x.name === name,
        ) as AbiEvent | undefined;
        expect(abiEvent, `${contract} has no event ${name}`).toBeDefined();
        const declared = parseAbiItem(`event ${sig}`) as AbiEvent;
        expect(toEventSelector(declared)).toBe(toEventSelector(abiEvent!));
        // the indexed-ness must agree too: it decides which params are topics vs data
        expect(declared.inputs.map((i) => i.indexed ?? false)).toEqual(abiEvent!.inputs.map((i) => i.indexed ?? false));
      });
    }
  }
});

describe("indexer helpers mirror the shared implementations", () => {
  it("flag decoding agrees", () => {
    const a = "0x00000000000000000000000000000000000000c4";
    expect(decodeFlags(a)).toEqual(decodeHookFlags(a));
    expect(decodeFlags("0x" + "00".repeat(18) + "0ac0")).toEqual(decodeHookFlags(("0x" + "00".repeat(18) + "0ac0") as `0x${string}`));
  });
  it("shortfall agrees", () => {
    for (const [q, s] of [[1000n, 820n], [0n, 0n], [5n, 9n], [10n ** 21n, 10n ** 21n - 1n]] as const) {
      expect(idxShortfall(q, s)).toBe(shortfallBps(q, s));
    }
  });
  it("decodes bytes32 reason codes", () => {
    const hex = "0x" + Buffer.from("SEVERE_SHORTFALL").toString("hex").padEnd(64, "0");
    expect(decodeReason(hex)).toBe("SEVERE_SHORTFALL");
    expect(decodeReason("0x" + "00".repeat(32))).toBe("");
  });
});

describe("scripts/gen-indexer-config.mjs", () => {
  const script = join(root, "scripts", "gen-indexer-config.mjs");
  const run = (...args: string[]) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const dir = mkdtempSync(join(tmpdir(), "genidx-"));
  const out = join(dir, "config.yaml");
  const dep = {
    infra: { poolManager: "0x1111111111111111111111111111111111111111" },
    core: {
      scoreboard: { address: "0x2222222222222222222222222222222222222222" },
      firmRouter: { address: "0x3333333333333333333333333333333333333333" },
      canaryRunner: { address: "0x4444444444444444444444444444444444444444" },
    },
    startBlock: 4242,
  };
  writeFileSync(join(dir, "dep.json"), JSON.stringify(dep));

  it("rewrites the four contract addresses and the start block, and quotes them", () => {
    run("--deployments", join(dir, "dep.json"), "--out", out);
    const y = readFileSync(out, "utf8");
    for (const a of ["1111", "2222", "3333", "4444"]) expect(y).toContain(`address: "0x${a.repeat(10)}`);
    expect(y).toContain("start_block: 4242");
    expect(y).not.toMatch(/^\s+rpc:/m);
  });

  it("--rpc makes the RPC the main source (for: sync) with a 100-block log window", () => {
    run("--deployments", join(dir, "dep.json"), "--out", out, "--rpc", "http://127.0.0.1:8546");
    const y = readFileSync(out, "utf8");
    expect(y).toContain("url: http://127.0.0.1:8546");
    expect(y).toContain("for: sync");
    expect(y).toContain("initial_block_interval: 100");
    expect(y).toContain("interval_ceiling: 100");
  });

  it("--rpc-only keeps the template's addresses", () => {
    run("--rpc-only", "--rpc", "https://rpc.example", "--out", out);
    const y = readFileSync(out, "utf8");
    expect(y).toContain("url: https://rpc.example");
    expect(y).toContain("0x451D64ab3b650040d2aE1886602b97ed6eDc643d");
  });

  it("is idempotent: running twice does not duplicate the rpc block", () => {
    run("--rpc-only", "--rpc", "https://rpc.example", "--out", out);
    run("--rpc-only", "--rpc", "https://rpc.example", "--config", out, "--out", out);
    expect((readFileSync(out, "utf8").match(/^\s+rpc:/gm) ?? []).length).toBe(1);
  });
});
