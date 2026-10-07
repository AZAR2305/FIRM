import { describe, expect, it } from "vitest";
import { MONAD_COLD_ACCOUNT_EXTRA, MONAD_COLD_SLOT_EXTRA, monadEstimate, recommend } from "../src/gasProfile";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("monadEstimate", () => {
  it("adds Monad's cold-access repricing per distinct slot and per cold account", () => {
    const pre = { [A]: { storage: { "0x1": "0x0", "0x2": "0x0" } }, [B]: { storage: { "0x1": "0x0" } }, [C]: {} };
    const e = monadEstimate(100_000, pre, []);
    expect(e.coldSlots).toBe(3);
    expect(e.coldAccounts).toBe(3);
    expect(e.monadEstimate).toBe(100_000 + 3 * MONAD_COLD_SLOT_EXTRA + 3 * MONAD_COLD_ACCOUNT_EXTRA);
  });
  it("does not charge the sender, the target or the tracer's coinbase entry as cold accounts", () => {
    const pre = { [A]: {}, [B]: { storage: { "0x1": "0x0" } }, [ZERO]: {}, [C]: {} };
    const e = monadEstimate(50_000, pre, [A.toUpperCase().replace("0X", "0x"), B]);
    expect(e.coldAccounts).toBe(1); // only C
    expect(e.coldSlots).toBe(1); // slots are charged even on a prewarmed account
  });
  it("is never below the measured gas", () => {
    expect(monadEstimate(7, {}, []).monadEstimate).toBe(7);
  });
});

describe("recommend", () => {
  it("applies the margin and rounds up to the step", () => {
    expect(recommend(188_801, 1.5, 25_000)).toBe(300_000);
    expect(recommend(292_672, 1.5, 25_000)).toBe(450_000);
    expect(recommend(100_000, 1, 25_000)).toBe(100_000);
    expect(recommend(100_001, 1, 25_000)).toBe(125_000);
  });
});
