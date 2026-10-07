import type { Address, Hex, PublicClient } from "viem";
import { IPoolManagerAbi, type Deployments, type Logger, type PoolKeyT } from "@firm/shared";
import type { Store } from "./store";

export interface PoolRecord {
  poolId: Hex;
  key: PoolKeyT;
}

const ZERO = "0x0000000000000000000000000000000000000000";

/** Pools of the seeded deployment (deployments/10143.json). Hookless pools are excluded: nothing to probe. */
export function staticPools(dep: Deployments): PoolRecord[] {
  const p = dep.pools;
  if (!p) return [];
  return Object.values(p.list)
    .filter((e) => e.hook.toLowerCase() !== ZERO)
    .map((e) => ({
      poolId: e.poolId,
      key: { currency0: p.currency0, currency1: p.currency1, fee: e.fee, tickSpacing: p.tickSpacing, hooks: e.hook },
    }));
}

const initializeEvent = IPoolManagerAbi.find((x) => x.type === "event" && x.name === "Initialize")!;

/**
 * New pools with a non-zero hook from PoolManager `Initialize` events (spec 11.1 step 1), scanned in small block
 * chunks because public RPCs limit getLogs ranges. Resumes from the stored cursor, so restarts never rescan.
 */
export async function discoverFromChain(
  client: PublicClient,
  dep: Deployments,
  store: Store,
  log: Logger,
  opts: { fromBlock?: bigint; chunk?: bigint } = {},
): Promise<PoolRecord[]> {
  const head = await client.getBlockNumber();
  const cursor = store.snapshot.lastScannedBlock;
  let from = cursor != null ? BigInt(cursor) + 1n : (opts.fromBlock ?? BigInt(dep.startBlock ?? Number(head)));
  const chunk = opts.chunk ?? 100n;
  const found: PoolRecord[] = [];

  while (from <= head) {
    const to = from + chunk - 1n > head ? head : from + chunk - 1n;
    const logs = await client.getLogs({ address: dep.infra.poolManager, event: initializeEvent as never, fromBlock: from, toBlock: to });
    for (const l of logs as unknown as { args: { id: Hex; currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address } }[]) {
      const a = l.args;
      if (a.hooks.toLowerCase() === ZERO) continue;
      const key = { currency0: a.currency0, currency1: a.currency1, fee: a.fee, tickSpacing: a.tickSpacing, hooks: a.hooks };
      store.addPool(a.id, key);
      found.push({ poolId: a.id, key });
    }
    store.setLastScannedBlock(to);
    from = to + 1n;
  }
  if (found.length) log.info("discovered pools with hooks", { count: found.length });
  return found;
}
