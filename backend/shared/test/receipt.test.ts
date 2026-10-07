import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex, type Log } from "viem";
import { FirmRouterAbi, describeFirmLogs } from "../src";

const E18 = 10n ** 18n;
const pool = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const hook = "0x00000000000000000000000000000000000000b4" as const;
const user = "0x00000000000000000000000000000000000000aa" as const;

/** build a log the way the EVM would, so parseEventLogs sees real topics and data */
function log(eventName: string, args: Record<string, unknown>): Log {
  const item = FirmRouterAbi.find((x) => x.type === "event" && x.name === eventName)! as any;
  const topics = encodeEventTopics({ abi: [item], eventName, args } as any) as Hex[];
  const dataInputs = item.inputs.filter((i: any) => !i.indexed);
  const data = encodeAbiParameters(dataInputs, dataInputs.map((i: any) => args[i.name] as never));
  return { address: "0x0000000000000000000000000000000000000001", topics, data, blockNumber: 1n, transactionHash: "0x", logIndex: 0, blockHash: "0x", transactionIndex: 0, removed: false } as unknown as Log;
}

describe("describeFirmLogs", () => {
  const names = new Map([[pool(2), "B"], [pool(3), "C"]]);

  it("renders the headline story in order", () => {
    const steps = describeFirmLogs(
      [
        log("Rejected", { poolId: pool(2), hook, quotedOut: 999n * E18, settledOut: 819_200_000_000_000_000_000n, execFailed: false }),
        log("Filled", { poolId: pool(3), hook, user, amountIn: 1000n * E18, quotedOut: 998_200_000_000_000_000_000n, settledOut: 998_200_000_000_000_000_000n, legIndex: 1 }),
      ],
      names,
    );
    expect(steps.map((s) => s.kind)).toEqual(["rejected", "filled"]);
    expect(steps[0]!.text).toBe("Pool B quoted 999.0 but delivered 819.2 (-18.0%). Rejected, strike recorded.");
    expect(steps[1]!.text).toBe("Filled via Pool C: received 998.2 (matches quote).");
  });

  it("explains every skip reason", () => {
    const text = (reason: number) => describeFirmLogs([log("LegSkipped", { poolId: pool(2), hook, reason })], names)[0]!.text;
    expect(text(0)).toContain("is BLOCKED");
    expect(text(1)).toContain("above its cap");
    expect(text(2)).toContain("could not be quoted");
    expect(text(3)).toContain("minimum");
    expect(text(4)).toContain("advertised off-chain");
  });

  it("execution failure and NoFill", () => {
    const steps = describeFirmLogs([
      log("Rejected", { poolId: pool(9), hook, quotedOut: 5n * E18, settledOut: 0n, execFailed: true }),
      log("NoFill", { user, amountIn: 5n * E18 }),
    ]);
    expect(steps[0]!.text).toContain("the swap failed");
    expect(steps[0]!.text).toContain("Pool 0x00000000"); // falls back to a short id
    expect(steps[1]!.text).toBe("No pool honoured its quote. Your tokens were returned.");
  });

  it("ignores unrelated logs", () => {
    expect(describeFirmLogs([{ address: user, topics: ["0x" + "11".repeat(32)], data: "0x" } as unknown as Log])).toEqual([]);
  });
});
