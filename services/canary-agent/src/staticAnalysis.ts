import type { Hex } from "viem";

/**
 * Context-sensitive opcodes (spec 11.1 step 2). Hooks that price a swap one way in a quote and another at settlement
 * "by inspecting the EVM environment" (0x) have to read one of these. Many honest hooks use some of them, so these
 * flags only PRIORITISE probing and enrich the report. They never change a hook's status.
 */
export const RISK_OPCODES: Record<number, string> = {
  0x31: "BALANCE",
  0x32: "ORIGIN",
  0x3a: "GASPRICE",
  0x3b: "EXTCODESIZE",
  0x3f: "EXTCODEHASH",
  0x40: "BLOCKHASH",
  0x41: "COINBASE",
  0x42: "TIMESTAMP",
  0x43: "NUMBER",
  0x44: "PREVRANDAO",
  0x47: "SELFBALANCE",
  0x5a: "GAS",
};

export interface DisassemblyResult {
  /** distinct risk opcodes in the code, sorted by name */
  riskFlags: string[];
  /** how many times each appears */
  counts: Record<string, number>;
  /** bytes of executable code walked (PUSH data skipped) */
  instructions: number;
}

/**
 * A tiny disassembler: walks the runtime bytecode and skips PUSH1..PUSH32 immediate data so that data bytes which
 * happen to equal a risk opcode value are not miscounted.
 */
export function analyzeBytecode(code: Hex | Uint8Array): DisassemblyResult {
  const bytes = typeof code === "string" ? hexToBytes(code) : code;
  const counts: Record<string, number> = {};
  let instructions = 0;
  for (let pc = 0; pc < bytes.length; ) {
    const op = bytes[pc]!;
    instructions++;
    const name = RISK_OPCODES[op];
    if (name) counts[name] = (counts[name] ?? 0) + 1;
    // PUSH1 (0x60) .. PUSH32 (0x7f): skip the immediate data
    pc += op >= 0x60 && op <= 0x7f ? 1 + (op - 0x5f) : 1;
  }
  return { riskFlags: Object.keys(counts).sort(), counts, instructions };
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error("invalid hex bytecode");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
