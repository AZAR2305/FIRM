import type { Abi, Address, Hex } from "viem";
import raw from "@/generated/deployments.json";

/** One contract entry of deployments/10143.json. */
export interface Entry {
  address: Address;
  contract: string;
  deployTx: string | null;
  blockNumber: number | null;
  verification: string;
}

export interface PoolEntry {
  description: string;
  poolId: Hex;
  hook: Address;
  fee: number;
}

/** Shape of deployments/10143.json as written by scripts/build-deployments.mjs (plus `source`, added by the sync script). */
export interface Deployments {
  chainId: 10143;
  network: string;
  generatedAt: string;
  owner: Address;
  /** "fork" when the build points at a local fork: the UI then shows a loud ribbon */
  source: "testnet" | "fork";
  infra: { poolManager: Address; v4Quoter: Address } & Record<string, Address>;
  core: { scoreboard: Entry; firmRouter: Entry; canaryRunner: Entry; rawRouter: Entry };
  fixtures: { tUSD: Entry; tUSDC: Entry } & Record<string, Entry>;
  pools: {
    currency0: Address;
    currency1: Address;
    /** direction of the demo trade tUSD -> tUSDC */
    zeroForOne: boolean;
    tickSpacing: number;
    list: Record<string, PoolEntry>;
  };
  abis: { Scoreboard: Abi; FirmRouter: Abi; RawRouter: Abi; CanaryRunner: Abi; MockToken: Abi; V4Quoter: Abi };
}

/** null until FIRM is deployed (the sync script writes a stub in that case). */
export const deployments: Deployments | null = (raw as { deployed?: boolean }).deployed === true ? (raw as unknown as Deployments) : null;

export const notDeployedReason: string = (raw as { reason?: string }).reason ?? "deployments/10143.json has not been created yet";

export function mustDeployments(): Deployments {
  if (!deployments) throw new Error("FIRM is not deployed yet");
  return deployments;
}

export interface TokenInfo {
  symbol: "tUSD" | "tUSDC";
  address: Address;
}

/** The two seeded mock tokens, from the deployments file. */
export function tokens(d: Deployments): { tUSD: TokenInfo; tUSDC: TokenInfo } {
  return {
    tUSD: { symbol: "tUSD", address: d.fixtures.tUSD.address },
    tUSDC: { symbol: "tUSDC", address: d.fixtures.tUSDC.address },
  };
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** name of a pool by id, e.g. "B" */
export function poolNameById(d: Deployments): Map<string, string> {
  return new Map(Object.entries(d.pools.list).map(([name, p]) => [p.poolId.toLowerCase(), name]));
}
