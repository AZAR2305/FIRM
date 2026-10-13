import { describe, expect, it } from "vitest";
import { parseIntentWithRules, validateIntent } from "@/lib/agentIntent";

const ADDR = "0x000000000000000000000000000000000000dEaD";

describe("validateIntent accepts a proposed order only if the message really contains it", () => {
  it("accepts an amount, token and recipient that are in the message", () => {
    const m = `swap 250 tUSD to tUSDC and send it to ${ADDR}`;
    expect(validateIntent(m, { amount: "250", tokenIn: "tUSD", recipient: ADDR })).toEqual({ ok: true, intent: { amount: "250", tokenIn: "tUSD", tokenOut: "tUSDC", recipient: ADDR } });
  });

  it("rejects a number the model invented", () => {
    const r = validateIntent("swap some tUSD", { amount: "5000", tokenIn: "tUSD", recipient: null });
    expect(r.ok).toBe(false);
  });

  it("rejects a recipient address that is not in the message (a model cannot redirect funds)", () => {
    const r = validateIntent("swap 100 tUSD to tUSDC", { amount: "100", tokenIn: "tUSD", recipient: ADDR });
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects bad tokens, zero, huge sizes and malformed amounts", () => {
    expect(validateIntent("swap 100 WETH", { amount: "100", tokenIn: "WETH", recipient: null }).ok).toBe(false);
    expect(validateIntent("swap 0 tUSD", { amount: "0", tokenIn: "tUSD", recipient: null }).ok).toBe(false);
    expect(validateIntent("swap 1000000 tUSD", { amount: "1000000", tokenIn: "tUSD", recipient: null }).ok).toBe(false);
    expect(validateIntent("swap 1e9 tUSD", { amount: "1e9", tokenIn: "tUSD", recipient: null }).ok).toBe(false);
  });

  it("asks for an address instead of guessing when told to send to 'him'", () => {
    const r = validateIntent("swap 100 tUSD to tUSDC and send it to him", { amount: "100", tokenIn: "tUSD", recipient: null });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/0x wallet address/);
  });

  it("understands thousands separators and 'k'", () => {
    expect(validateIntent("sell 1,500 tUSDC", { amount: "1500", tokenIn: "tUSDC", recipient: null })).toMatchObject({ ok: true });
    expect(validateIntent("sell 2k tUSD", { amount: "2000", tokenIn: "tUSD", recipient: null })).toMatchObject({ ok: true });
  });
});

describe("parseIntentWithRules (no model)", () => {
  it("reads simple orders in both directions", () => {
    expect(parseIntentWithRules("Swap 250 tUSD to tUSDC")).toMatchObject({ ok: true, intent: { amount: "250", tokenIn: "tUSD", tokenOut: "tUSDC", recipient: null } });
    expect(parseIntentWithRules("sell 1,500 tUSDC for tUSD")).toMatchObject({ ok: true, intent: { amount: "1500", tokenIn: "tUSDC", tokenOut: "tUSD" } });
  });

  it("picks up a recipient address from the message", () => {
    expect(parseIntentWithRules(`swap 100 tUSD to tUSDC and send it to ${ADDR}`)).toMatchObject({ ok: true, intent: { recipient: ADDR } });
  });

  it("does not guess when there is no amount", () => {
    expect(parseIntentWithRules("swap my tokens please").ok).toBe(false);
    expect(parseIntentWithRules("hello").ok).toBe(false);
  });
});
