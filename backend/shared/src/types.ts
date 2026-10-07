import type { Address, Hex } from "viem";

/** Mirrors the Solidity Status enum. */
export const STATUS_NAMES = ["UNRATED", "NORMAL", "WATCH", "BLOCKED"] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

export interface PoolKeyT {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** Mirrors the Solidity Route struct passed to FirmRouter.swapExactIn / CanaryRunner.probe. */
export interface RouteT {
  key: PoolKeyT;
  zeroForOne: boolean;
  hookData: Hex;
  advertisedOut: bigint;
}

export interface HookStatsT {
  fills: number;
  strikes: number;
  probes: number;
  probeStrikes: number;
  cleanProbes: number;
  cleanStreak: number;
  recentStrikes: number;
  cleanProbeSenders: number;
  windowStart: bigint;
  lastStrikeAt: bigint;
  firstSeenAt: bigint;
  cumShortfallBps: bigint;
  status: StatusName;
}

/** LegSkipped reason codes emitted by FirmRouter. */
export const SKIP_REASONS: Record<number, string> = {
  0: "BLOCKED",
  1: "UNRATED_CAP",
  2: "QUOTE_FAILED",
  3: "BELOW_MIN_OUT",
  4: "ADVERTISED_MISMATCH",
};
