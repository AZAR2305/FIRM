import type { Address } from "viem";

/** Hook permission bits: the low 14 bits of a hook address (v4-core Hooks.sol, confirmed in docs/SPIKES.md S4). */
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

const MASK = (1n << 14n) - 1n;

/** Names of the permission flags encoded in a hook address, highest bit first. */
export function decodeHookFlags(hook: Address | string): HookFlag[] {
  const low = BigInt(hook) & MASK;
  return (Object.entries(HOOK_FLAG_BITS) as [HookFlag, number][]).filter(([, bit]) => (low >> BigInt(bit)) & 1n).map(([name]) => name);
}

/** True if the hook can change what a swap delivers: it returns a delta from beforeSwap or afterSwap. These are the hooks a trader must watch. */
export function canChangeSwapAmounts(hook: Address | string): boolean {
  const f = decodeHookFlags(hook);
  return f.includes("BEFORE_SWAP_RETURNS_DELTA") || f.includes("AFTER_SWAP_RETURNS_DELTA");
}

/** A plain-language reading of the flags, for people who do not read bit masks. Deterministic, never an opinion about honesty. */
export function describeFlags(hook: Address | string): string {
  const f = decodeHookFlags(hook);
  if (f.length === 0) return "No permissions: this hook cannot run during a swap.";
  const parts: string[] = [];
  if (canChangeSwapAmounts(hook)) parts.push("it can change the amount a swap delivers (it returns a delta), so a quote and a fill can differ");
  else if (f.includes("BEFORE_SWAP") || f.includes("AFTER_SWAP")) parts.push("it runs during swaps but cannot change the amounts directly");
  else parts.push("it does not run during swaps");
  if (f.includes("BEFORE_SWAP") && !f.includes("BEFORE_SWAP_RETURNS_DELTA")) parts.push("it can set the fee per swap (dynamic fee) or revert a swap");
  const text = parts.join("; ") + ".";
  return text.charAt(0).toUpperCase() + text.slice(1);
}
