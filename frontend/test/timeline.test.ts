import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex, type Log } from "viem";
import { describeLogs } from "@/lib/timeline";

// The event signatures of IFirmRouter / RawRouter (contracts/src/interfaces/IFirmRouter.sol, contracts/src/RawRouter.sol).
const firmAbi = parseAbi([
  "event LegSkipped(bytes32 indexed poolId, address indexed hook, uint8 reason)",
  "event Rejected(bytes32 indexed poolId, address indexed hook, uint256 quotedOut, uint256 settledOut, bool execFailed)",
  "event Filled(bytes32 indexed poolId, address indexed hook, address indexed user, uint256 amountIn, uint256 quotedOut, uint256 settledOut, uint8 legIndex)",
  "event NoFill(address indexed user, uint256 amountIn)",
]);
const rawAbi = parseAbi(["event RawSwap(bytes32 indexed poolId, address indexed hook, address indexed user, uint256 amountIn, uint256 amountOut)"]);

const E18 = 10n ** 18n;
const POOL_B = `0x${"b".repeat(64)}` as Hex;
const POOL_C = `0x${"c".repeat(64)}` as Hex;
const HOOK_B = "0x00000000000000000000000000000000000000b1" as const;
const HOOK_C = "0x00000000000000000000000000000000000000c1" as const;
const USER = "0x00000000000000000000000000000000000000aa" as const;
const names = new Map([[POOL_B, "B"], [POOL_C, "C"]]);

function log(abi: typeof firmAbi | typeof rawAbi, eventName: string, indexed: Record<string, unknown>, dataTypes: { type: string }[], dataValues: unknown[], logIndex: number): Log {
  const topics = encodeEventTopics({ abi, eventName, args: indexed } as never) as Hex[];
  return {
    address: "0x0000000000000000000000000000000000000fff",
    topics: topics as [Hex, ...Hex[]],
    data: dataTypes.length ? encodeAbiParameters(dataTypes as never, dataValues as never) : "0x",
    logIndex,
    blockHash: null, blockNumber: null, transactionHash: null, transactionIndex: null, removed: false,
  } as unknown as Log;
}

describe("swap timeline (spec 12.4)", () => {
  it("describes the headline demo: skip, reject with numbers, fill", () => {
    const logs = [
      log(firmAbi, "LegSkipped", { poolId: POOL_B, hook: HOOK_B }, [{ type: "uint8" }], [0], 0),
      log(firmAbi, "Rejected", { poolId: POOL_B, hook: HOOK_B }, [{ type: "uint256" }, { type: "uint256" }, { type: "bool" }], [999n * E18, 8192n * E18 / 10n, false], 1),
      log(firmAbi, "Filled", { poolId: POOL_C, hook: HOOK_C, user: USER }, [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }], [1000n * E18, 9982n * E18 / 10n, 9982n * E18 / 10n, 1], 2),
    ];
    const steps = describeLogs(logs, firmAbi, rawAbi, names);
    expect(steps.map((s) => s.kind)).toEqual(["skipped", "rejected", "filled"]);
    expect(steps[0]!.text).toBe("Skipped Pool B: hook 0x0000...00B1 is BLOCKED.");
    // the exact wording of the spec's example
    expect(steps[1]!.text).toBe("Pool B quoted 999.0, delivered 819.2 (-18.0%). Rejected, strike recorded.");
    expect(steps[2]!.text).toBe("Filled via Pool C: received 998.2 (matches quote).");
    expect(steps[2]!.amount).toBe(9982n * E18 / 10n);
  });

  it("describes a failed leg, an advertised-quote mismatch and NoFill", () => {
    const logs = [
      log(firmAbi, "LegSkipped", { poolId: POOL_B, hook: HOOK_B }, [{ type: "uint8" }], [4], 0),
      log(firmAbi, "Rejected", { poolId: POOL_C, hook: HOOK_C }, [{ type: "uint256" }, { type: "uint256" }, { type: "bool" }], [997n * E18, 0n, true], 1),
      log(firmAbi, "NoFill", { user: USER }, [{ type: "uint256" }], [1000n * E18], 2),
    ];
    const steps = describeLogs(logs, firmAbi, rawAbi, names);
    expect(steps[0]!.text).toContain("its in-transaction quote was below the quote it advertised off-chain");
    expect(steps[1]!.text).toBe("Pool C quoted 997.0 but the swap failed. Rejected, strike recorded.");
    expect(steps[2]).toMatchObject({ kind: "nofill", text: "No pool honoured its quote. Your tokens were returned." });
  });

  it("describes the raw router's unchecked swap, and orders mixed logs by log index", () => {
    const logs = [
      log(rawAbi, "RawSwap", { poolId: POOL_B, hook: HOOK_B, user: USER }, [{ type: "uint256" }, { type: "uint256" }], [1000n * E18, 819n * E18], 5),
      log(firmAbi, "LegSkipped", { poolId: POOL_C, hook: HOOK_C }, [{ type: "uint8" }], [1], 2),
    ];
    const steps = describeLogs(logs, firmAbi, rawAbi, names);
    expect(steps.map((s) => s.kind)).toEqual(["skipped", "raw"]);
    expect(steps[1]!.text).toContain("with no check");
    expect(steps[1]!.amount).toBe(819n * E18);
  });

  it("ignores unrelated logs and falls back to a short pool id when the name is unknown", () => {
    const stranger = { address: "0x0000000000000000000000000000000000000001", topics: [`0x${"1".repeat(64)}`], data: "0x", logIndex: 0 } as unknown as Log;
    const unknown = log(firmAbi, "LegSkipped", { poolId: `0x${"d".repeat(64)}`, hook: HOOK_B }, [{ type: "uint8" }], [2], 1);
    const steps = describeLogs([stranger, unknown], firmAbi, rawAbi, names);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.text.startsWith("Skipped Pool 0xdddddddd")).toBe(true);
    expect(steps[0]!.text).toContain("it could not be quoted");
  });
});
