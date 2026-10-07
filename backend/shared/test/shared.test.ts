import { describe, expect, it } from "vitest";
import { shortfallBps, floorOf, fmt18, decodeHookFlags, canChangeSwapAmounts, RateLimiter, endpointsFromEnv } from "../src";

describe("math mirrors the Solidity RouteLib", () => {
  it("shortfall", () => {
    expect(shortfallBps(1000n, 820n)).toBe(1800n);
    expect(shortfallBps(1000n, 1000n)).toBe(0n);
    expect(shortfallBps(1000n, 2000n)).toBe(0n);
    expect(shortfallBps(0n, 0n)).toBe(10_000n);
    expect(shortfallBps(1000n * 10n ** 18n, 999n * 10n ** 18n)).toBe(10n); // exactly the 10 bps tolerance
  });
  it("floor rounds down", () => {
    expect(floorOf(1000n, 10)).toBe(999n);
    expect(floorOf(999n, 10)).toBe(998n); // 999 * 9990 / 10000 = 998.001, rounded down
  });
  it("fmt18", () => {
    expect(fmt18(998199652299447526702n)).toBe("998.1996");
    expect(fmt18(-(10n ** 18n))).toBe("-1.0000");
  });
});

describe("hook flags", () => {
  it("decodes Counter's 0x0ac0 (beforeAdd/beforeRemove liquidity + beforeSwap + afterSwap)", () => {
    const addr = "0x00000000000000000000000000000000000000c0" as const;
    expect(decodeHookFlags(("0x" + "00".repeat(18) + "0ac0") as `0x${string}`)).toEqual([
      "BEFORE_ADD_LIQUIDITY",
      "BEFORE_REMOVE_LIQUIDITY",
      "BEFORE_SWAP",
      "AFTER_SWAP",
    ]);
    expect(decodeHookFlags(addr)).toEqual(["BEFORE_SWAP", "AFTER_SWAP"]);
  });
  it("detects delta-returning hooks", () => {
    expect(canChangeSwapAmounts(("0x" + "00".repeat(18) + "0044") as `0x${string}`)).toBe(true); // afterSwap + returnsDelta
    expect(canChangeSwapAmounts(("0x" + "00".repeat(18) + "0080") as `0x${string}`)).toBe(false); // beforeSwap only
  });
});

describe("rate limiter", () => {
  it("never exceeds its budget", async () => {
    const rl = new RateLimiter(20);
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) await rl.take(); // 20 free, 10 more at 20/s => >= ~450ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(400);
  });
});

describe("rpc config", () => {
  it("defaults to the three documented public RPCs, primary first", () => {
    const e = endpointsFromEnv("");
    expect(e.map((x) => x.url)).toEqual([
      "https://testnet-rpc.monad.xyz",
      "https://rpc.ankr.com/monad_testnet",
      "https://rpc-testnet.monadinfra.com",
    ]);
  });
  it("keeps env order", () => {
    expect(endpointsFromEnv("http://a, http://b").map((x) => x.url)).toEqual(["http://a", "http://b"]);
  });
});
