import type { Address, Hex } from "viem";
import type { Deployments, StatusName } from "@firm/shared";
import type { ChainReader, QuoteRequest, SwapPreview } from "../src/chainReader";
import type { PoolInfo, PoolSource } from "../src/pools";

export const T0 = "0x1111111111111111111111111111111111111111" as Address; // tUSD-like, currency0
export const T1 = "0x2222222222222222222222222222222222222222" as Address;
export const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export const hookB = "0x00000000000000000000000000000000000000b4" as Address;
export const hookC = "0x00000000000000000000000000000000000000c4" as Address;
export const hookD = "0x00000000000000000000000000000000000000d4" as Address;

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

export const pool = (n: number, hook: Address, fee: number): PoolInfo => ({
  poolId: id(n),
  description: `pool-${n}`,
  key: { currency0: T0, currency1: T1, fee, tickSpacing: 60, hooks: hook },
});

export const POOL_A = pool(1, ZERO, 2500);
export const POOL_B = pool(2, hookB, 1000);
export const POOL_C = pool(3, hookC, 500);
export const POOL_D = pool(4, hookD, 4000);

export class FakeSource implements PoolSource {
  constructor(public pools: PoolInfo[]) {}
  async poolsForPair() {
    return this.pools;
  }
  async allHooks() {
    return this.pools.map((p) => p.key.hooks).filter((h) => h !== ZERO);
  }
}

export class FakeChain implements ChainReader {
  quoteCalls = 0;
  constructor(
    public opts: {
      quotes: Record<string, bigint | null | undefined>; // by poolId
      status?: Record<string, StatusName>; // by lowercase hook
      liquidity?: Record<string, bigint>; // by poolId, default 1
      cap?: bigint;
    },
  ) {}
  async blockNumber() {
    return 123n;
  }
  async statuses(hooks: Address[]) {
    return new Map(hooks.map((h) => [h.toLowerCase(), this.opts.status?.[h.toLowerCase()] ?? "UNRATED"] as const));
  }
  async tolerances(hooks: Address[]) {
    return new Map(hooks.map((h) => [h.toLowerCase(), 10] as const));
  }
  async unratedCap() {
    return this.opts.cap ?? 100n * 10n ** 18n;
  }
  async liquidity(ids: Hex[]) {
    return new Map(ids.map((i) => [i.toLowerCase(), this.opts.liquidity?.[i] ?? 1n] as const));
  }
  async quotes(reqs: QuoteRequest[]) {
    this.quoteCalls++;
    return reqs.map((r) => {
      const p = [POOL_A, POOL_B, POOL_C, POOL_D].find((x) => x.key.hooks === r.key.hooks && x.key.fee === r.key.fee);
      return p ? (this.opts.quotes[p.poolId] ?? null) : null;
    });
  }
  async preview(): Promise<SwapPreview> {
    return { naiveOut: 819n, firmOut: 998n, firmLegIndex: 1 };
  }
  rpcInUse() {
    return "mock";
  }
}

export const E18 = 10n ** 18n;

/** Quotes matching the demo: B 999.0 > C 998.2 > A 997.5 > D 996.0 */
export const demoQuotes = {
  [POOL_A.poolId]: 997_500n * 10n ** 15n,
  [POOL_B.poolId]: 999_000n * 10n ** 15n,
  [POOL_C.poolId]: 998_200n * 10n ** 15n,
  [POOL_D.poolId]: 996_000n * 10n ** 15n,
};

export const fakeDeployments = {
  chainId: 10143,
  network: "Monad Testnet",
  generatedAt: new Date().toISOString(),
  owner: ZERO,
  infra: {} as Deployments["infra"],
  core: { scoreboard: { address: ZERO } } as unknown as Deployments["core"],
  fixtures: null,
  pools: null,
  startBlock: null,
} as Deployments;
