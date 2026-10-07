import type { Address } from "viem";

/** Hook permission bits (v4-core Hooks.sol, confirmed in docs/SPIKES.md S4). The low 14 bits of a hook address. */
export const HOOK_FLAG_BITS = {
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
} as const;

export type HookFlag = keyof typeof HOOK_FLAG_BITS;

export const ALL_HOOK_MASK = (1n << 14n) - 1n;

/** Names of the permission flags encoded in a hook address, highest bit first. */
export function decodeHookFlags(hook: Address): HookFlag[] {
  const low = BigInt(hook) & ALL_HOOK_MASK;
  return (Object.entries(HOOK_FLAG_BITS) as [HookFlag, number][])
    .filter(([, bit]) => (low >> BigInt(bit)) & 1n)
    .map(([name]) => name);
}

/** True if the hook can change swap amounts: it returns a delta from beforeSwap or afterSwap. */
export function canChangeSwapAmounts(hook: Address): boolean {
  const flags = decodeHookFlags(hook);
  return flags.includes("BEFORE_SWAP_RETURNS_DELTA") || flags.includes("AFTER_SWAP_RETURNS_DELTA");
}
