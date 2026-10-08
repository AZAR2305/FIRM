import { describe, expect, it } from "vitest";
import { fmt, floorOf, parseAmount, pct, relativeTime, shortfallBps } from "@/lib/format";
import { statusName, STATUS_ORDER } from "@/lib/status";
import { bufferedGas, describeError } from "@/lib/tx";

const E18 = 10n ** 18n;

describe("format", () => {
  it("parses user amounts and rejects junk, zero and negatives", () => {
    expect(parseAmount("1000")).toBe(1000n * E18);
    expect(parseAmount("1,000.5")).toBe(10005n * E18 / 10n);
    expect(parseAmount(".5")).toBe(E18 / 2n);
    for (const bad of ["", " ", ".", "0", "0.0", "-1", "abc", "1e3", "1.2.3"]) expect(parseAmount(bad), bad).toBeNull();
  });

  it("formats 18-decimal amounts rounded to the nearest, like the spec's examples", () => {
    expect(fmt(998199652299447526702n, 1)).toBe("998.2");
    expect(fmt(998199652299447526702n, 2)).toBe("998.20");
    expect(fmt(819179181639997541642n, 1)).toBe("819.2");
    expect(fmt(998997006003979006052n, 1)).toBe("999.0");
    expect(fmt(E18 / 20n, 1)).toBe("0.1"); // half rounds up
    expect(fmt(E18 / 40n, 1)).toBe("0.0");
    expect(fmt(1234567n * E18, 0)).toBe("1,234,567");
    expect(fmt(-5n * E18, 1)).toBe("-5.0");
  });

  it("mirrors RouteLib's shortfall and floor", () => {
    expect(shortfallBps(0n, 0n)).toBe(10_000n);
    expect(shortfallBps(999n * E18, 1000n * E18)).toBe(0n);
    expect(shortfallBps(1000n * E18, 820n * E18)).toBe(1800n);
    expect(shortfallBps(999n * E18, 8192n * E18 / 10n)).toBe(1799n); // truncates, like the contract
    expect(floorOf(1000n * E18, 10)).toBe(999n * E18);
    expect(pct(1800n)).toBe("18.0%");
  });

  it("describes time since a strike", () => {
    expect(relativeTime(0, 1_000)).toBe("never");
    expect(relativeTime(998, 1_000)).toBe("just now");
    expect(relativeTime(940, 1_000)).toBe("1 min ago");
    expect(relativeTime(1_000 - 7_200, 1_000)).toBe("2 h ago");
    expect(relativeTime(1_000 - 200_000, 1_000)).toBe("2 d ago");
  });
});

describe("status", () => {
  it("maps Scoreboard.Status indices and sorts BLOCKED before WATCH before UNRATED before NORMAL", () => {
    expect([0, 1, 2, 3].map(statusName)).toEqual(["UNRATED", "NORMAL", "WATCH", "BLOCKED"]);
    expect(statusName(99)).toBe("UNRATED");
    const sorted = (["NORMAL", "UNRATED", "BLOCKED", "WATCH"] as const).slice().sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b]);
    expect(sorted).toEqual(["BLOCKED", "WATCH", "UNRATED", "NORMAL"]);
  });
});

describe("tx helpers", () => {
  it("adds a small buffer to the gas estimate (Monad charges the limit)", () => {
    expect(bufferedGas(1_000_000n)).toBe(1_200_000n);
  });

  it("turns wallet rejections and RPC errors into one readable line", () => {
    expect(describeError({ name: "UserRejectedRequestError", message: "x" })).toMatch(/rejected the request in your wallet/);
    expect(describeError({ cause: { name: "UserRejectedRequestError" } })).toMatch(/Nothing was sent/);
    expect(describeError({ shortMessage: "The contract function reverted.\nmore detail" })).toBe("The contract function reverted.");
    expect(describeError(undefined)).toBe("Unknown error");
  });
});
