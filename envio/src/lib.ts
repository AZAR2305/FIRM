// Pure helpers for the handlers. Kept free of Envio imports so they can be unit-tested with plain Node.

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const STATUS_NAMES = ["UNRATED", "NORMAL", "WATCH", "BLOCKED"] as const;

/** Hook permission bits (v4-core Hooks.sol; docs/SPIKES.md S4). */
export const HOOK_FLAG_BITS: Record<string, number> = {
  BEFORE_INITIALIZE: 13,
  AFTER_INITIALIZE: 12,
  BEFORE_ADD_LIQUIDITY: 11,
  AFTER_ADD_LIQUIDITY: 10,
  BEFORE_REMOVE_LIQUIDITY: 9,
  AFTER_REMOVE_LIQUIDITY: 8,
  BEFORE_SWAP: 7,
  AFTER_SWAP: 6,
  BEFORE_DONATE: 5,
  AFTER_DONATE: 4,
  BEFORE_SWAP_RETURNS_DELTA: 3,
  AFTER_SWAP_RETURNS_DELTA: 2,
  AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 1,
  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 0,
};

export const ALL_HOOK_MASK = (1n << 14n) - 1n;

export const lc = (s: string) => s.toLowerCase();

/** Names of the permission flags encoded in the low 14 bits of a hook address. */
export function decodeFlags(address: string): string[] {
  const low = BigInt(address) & ALL_HOOK_MASK;
  return Object.entries(HOOK_FLAG_BITS)
    .filter(([, bit]) => (low >> BigInt(bit)) & 1n)
    .map(([name]) => name);
}

/** shortfall_bps = max(0, quoted - settled) * 10000 / quoted (same formula as the contract; zero quote = 100%). */
export function shortfallBps(quoted: bigint, settled: bigint): bigint {
  if (quoted === 0n) return 10_000n;
  if (settled >= quoted) return 0n;
  return ((quoted - settled) * 10_000n) / quoted;
}

/** bytes32 short string ("SEVERE_SHORTFALL" padded with zero bytes) to text. */
export function decodeReason(b32: string): string {
  const hex = b32.startsWith("0x") ? b32.slice(2) : b32;
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}
