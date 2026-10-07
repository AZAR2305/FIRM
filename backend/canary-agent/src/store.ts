import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import type { PoolKeyT } from "@firm/shared";

export interface ProbeRecord {
  poolId: Hex;
  hook: Address;
  zeroForOne: boolean;
  amountIn: string;
  senderIdx: number;
  probeSender: Address;
  quotedOut: string;
  settledOut: string;
  shortfallBps: string;
  txHash: Hex;
  blockNumber: string;
  ts: number;
  /** which re-probe round this belongs to (0 = first) */
  round: number;
}

export interface StateFile {
  version: 1;
  /** last block scanned for Initialize events */
  lastScannedBlock: string | null;
  probes: ProbeRecord[];
  /** per pool: unix seconds of the last completed probe round */
  lastRoundAt: Record<string, number>;
  /** per pool: current re-probe round counter */
  round: Record<string, number>;
  /** pools found by the chain scan (the scan cursor only moves forward, so they must be remembered) */
  pools: Record<string, PoolKeyT>;
}

const empty = (): StateFile => ({ version: 1, lastScannedBlock: null, probes: [], lastRoundAt: {}, round: {}, pools: {} });

/**
 * Idempotency store (spec 11.1: "persist probe schedules and results so restarts do not double-probe").
 * A plain JSON file written atomically: the canary writes a few dozen records per hook, so a database would add a
 * native dependency (and a Windows build step) for no benefit. SQLite can replace this behind the same interface.
 */
export class Store {
  private state: StateFile;
  constructor(private readonly path: string) {
    this.state = existsSync(path) ? { ...empty(), ...JSON.parse(readFileSync(path, "utf8")) } : empty();
  }

  get snapshot(): StateFile {
    return this.state;
  }

  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }

  private static slot(poolId: string, zeroForOne: boolean, amountIn: string, senderIdx: number, round: number) {
    return `${poolId.toLowerCase()}|${zeroForOne}|${amountIn}|${senderIdx}|${round}`;
  }

  hasProbe(poolId: string, zeroForOne: boolean, amountIn: bigint, senderIdx: number, round: number): boolean {
    const k = Store.slot(poolId, zeroForOne, amountIn.toString(), senderIdx, round);
    return this.state.probes.some((p) => Store.slot(p.poolId, p.zeroForOne, p.amountIn, p.senderIdx, p.round) === k);
  }

  addProbe(p: ProbeRecord) {
    this.state.probes.push(p);
    this.flush();
  }

  probesFor(hook: string): ProbeRecord[] {
    return this.state.probes.filter((p) => p.hook.toLowerCase() === hook.toLowerCase());
  }

  currentRound(poolId: string): number {
    return this.state.round[poolId.toLowerCase()] ?? 0;
  }

  completeRound(poolId: string, nowSec: number) {
    const k = poolId.toLowerCase();
    this.state.lastRoundAt[k] = nowSec;
    this.flush();
  }

  startNextRound(poolId: string) {
    const k = poolId.toLowerCase();
    this.state.round[k] = (this.state.round[k] ?? 0) + 1;
    this.flush();
  }

  lastRoundAt(poolId: string): number | undefined {
    return this.state.lastRoundAt[poolId.toLowerCase()];
  }

  addPool(poolId: string, key: PoolKeyT) {
    this.state.pools[poolId.toLowerCase()] = key;
    this.flush();
  }

  knownPools(): { poolId: Hex; key: PoolKeyT }[] {
    return Object.entries(this.state.pools).map(([poolId, key]) => ({ poolId: poolId as Hex, key }));
  }

  setLastScannedBlock(b: bigint) {
    this.state.lastScannedBlock = b.toString();
    this.flush();
  }
}
