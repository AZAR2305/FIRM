import { readFileSync } from "node:fs";
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
