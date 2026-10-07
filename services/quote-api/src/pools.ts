import type { Address, Hex } from "viem";
import { z } from "zod";
import type { Deployments, PoolKeyT, Logger } from "@firm/shared";

export interface PoolInfo {
  poolId: Hex;
  key: PoolKeyT;
  description?: string;
}

/** Where candidate pools come from. The indexer is primary; deployments.json is the static fallback (F4). */
export interface PoolSource {
  poolsForPair(tokenA: Address, tokenB: Address): Promise<PoolInfo[]>;
  /** every non-zero hook known to this source */
  allHooks(): Promise<Address[]>;
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Static pools from deployments/10143.json (the seeded fixture pools). */
export class DeploymentsPoolSource implements PoolSource {
  constructor(private readonly dep: Deployments) {}

  private all(): PoolInfo[] {
    const p = this.dep.pools;
    if (!p) return [];
    return Object.values(p.list).map((e) => ({
      poolId: e.poolId,
      description: e.description,
      key: { currency0: p.currency0, currency1: p.currency1, fee: e.fee, tickSpacing: p.tickSpacing, hooks: e.hook },
    }));
  }

  async poolsForPair(a: Address, b: Address) {
    return this.all().filter(
      (p) =>
        (same(p.key.currency0, a) && same(p.key.currency1, b)) || (same(p.key.currency0, b) && same(p.key.currency1, a)),
    );
  }

  async allHooks() {
    return [...new Set(this.all().map((p) => p.key.hooks.toLowerCase() as Address))].filter((h) => h !== ZERO);
  }
}

const gqlPool = z.object({
  id: z.string(),
  currency0: z.string(),
  currency1: z.string(),
  fee: z.number(),
  tickSpacing: z.number(),
  hook: z.object({ id: z.string() }).nullable().optional(),
});

/** Pools discovered by the Envio indexer (schema in indexer/schema.graphql). */
export class IndexerPoolSource implements PoolSource {
  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async query<T>(query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
    const body = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`indexer: ${body.errors[0]?.message}`);
    return schema.parse(body.data);
  }

  async poolsForPair(a: Address, b: Address) {
    const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    const data = await this.query(
      `query($c0: String!, $c1: String!) { Pool(where: {currency0: {_eq: $c0}, currency1: {_eq: $c1}}) { id currency0 currency1 fee tickSpacing hook { id } } }`,
      { c0: c0.toLowerCase(), c1: c1.toLowerCase() },
      z.object({ Pool: z.array(gqlPool) }),
    );
    return data.Pool.map((p) => ({
      poolId: p.id as Hex,
      key: {
        currency0: p.currency0 as Address,
        currency1: p.currency1 as Address,
        fee: p.fee,
        tickSpacing: p.tickSpacing,
        hooks: (p.hook?.id ?? ZERO) as Address,
      },
    }));
  }

  async allHooks() {
    const data = await this.query(`{ Hook(limit: 500) { id } }`, {}, z.object({ Hook: z.array(z.object({ id: z.string() })) }));
    return data.Hook.map((h) => h.id as Address);
  }
}

/** Tries the primary source and falls back to the secondary one on any error. */
export class FallbackPoolSource implements PoolSource {
  constructor(
    private readonly primary: PoolSource,
    private readonly secondary: PoolSource,
    private readonly log?: Logger,
  ) {}

  async poolsForPair(a: Address, b: Address) {
    try {
      const r = await this.primary.poolsForPair(a, b);
      if (r.length > 0) return r;
    } catch (e) {
      this.log?.warn("pool source primary failed, using fallback", { err: (e as Error).message });
    }
    return this.secondary.poolsForPair(a, b);
  }

  async allHooks() {
    try {
      const r = await this.primary.allHooks();
      if (r.length > 0) return r;
    } catch (e) {
      this.log?.warn("hook source primary failed, using fallback", { err: (e as Error).message });
    }
    return this.secondary.allHooks();
  }
}
