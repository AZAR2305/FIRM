import { indexer, type Hook } from "envio";
import { ALL_HOOK_MASK, ZERO_ADDRESS, decodeFlags, decodeReason, lc, shortfallBps, STATUS_NAMES } from "./lib";

// Handler rules (spec 9.3):
//  - Hook entities are created lazily; permission flags are decoded from the address alone, so the order in which the
//    PoolManager and Scoreboard events arrive does not matter.
//  - Hook status is taken from StatusChanged events, never recomputed offchain.
//  - shortfallBps uses the same formula as the contract.

// the only part of the handler context getOrCreateHook needs
type HookReader = { Hook: { get(id: string): Promise<Hook | undefined> } };

async function getOrCreateHook(context: HookReader, hookAddress: string): Promise<Hook> {
  const id = lc(hookAddress);
  const existing = await context.Hook.get(id);
  if (existing) return existing;
  return {
    id,
    status: "UNRATED",
    fills: 0,
    strikes: 0,
    probes: 0,
    probeStrikes: 0,
    cumShortfallBps: 0n,
    avgShortfallBps: 0n,
    lastStrikeAt: undefined,
    flags: decodeFlags(id),
  };
}

const eid = (e: { chainId: number; block: { number: number }; logIndex: number }) => `${e.chainId}_${e.block.number}_${e.logIndex}`;

// ---------------------------------------------------------------- PoolManager
indexer.onEvent(
  { contract: "PoolManager", event: "Initialize", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const hook = lc(event.params.hooks);
    const hasHook = hook !== ZERO_ADDRESS;
    if (hasHook) context.Hook.set(await getOrCreateHook(context, hook));
    context.Pool.set({
      id: lc(event.params.id),
      hook_id: hasHook ? hook : undefined,
      currency0: lc(event.params.currency0),
      currency1: lc(event.params.currency1),
      fee: Number(event.params.fee),
      tickSpacing: Number(event.params.tickSpacing),
      createdAt: event.block.timestamp,
    });
  },
);

// ---------------------------------------------------------------- Scoreboard
indexer.onEvent(
  { contract: "Scoreboard", event: "FillRecorded" },
  async ({ event, context }) => {
    const hook = await getOrCreateHook(context, event.params.hook);
    context.Hook.set({ ...hook, fills: hook.fills + 1 });
  },
);

indexer.onEvent(
  { contract: "Scoreboard", event: "StrikeRecorded", fields: { transaction: ["hash"], block: ["timestamp"] } },
  async ({ event, context }) => {
    const hook = await getOrCreateHook(context, event.params.hook);
    const strikes = hook.strikes + 1;
    const cum = hook.cumShortfallBps + event.params.shortfallBps;
    context.Hook.set({
      ...hook,
      strikes,
      cumShortfallBps: cum,
      avgShortfallBps: cum / BigInt(Math.max(strikes, 1)),
      lastStrikeAt: event.block.timestamp,
    });
    context.Strike.set({
      id: eid(event),
      pool_id: lc(event.params.poolId),
      hook_id: hook.id,
      quotedOut: event.params.quotedOut,
      settledOut: event.params.settledOut,
      // the contract emits shortfall in bps; recompute with the same formula and fall back to the emitted value
      shortfallBps: Number(event.params.execFailed ? 10_000n : shortfallBps(event.params.quotedOut, event.params.settledOut)),
      execFailed: event.params.execFailed,
      txHash: event.transaction.hash,
      ts: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "Scoreboard", event: "ProbeRecorded", fields: { transaction: ["hash"], block: ["timestamp"] } },
  async ({ event, context }) => {
    const hook = await getOrCreateHook(context, event.params.hook);
    let next = { ...hook, probes: hook.probes + 1, probeStrikes: hook.probeStrikes + (event.params.strike ? 1 : 0) };
    if (event.params.strike) {
      // The Scoreboard counts a probe strike as a strike but emits only ProbeRecorded for it (no StrikeRecorded), so the
      // hook's strike counters and the Strike entity must be derived here to match the contract's HookStats.
      const strikes = next.strikes + 1;
      const cum = next.cumShortfallBps + event.params.shortfallBps;
      next = { ...next, strikes, cumShortfallBps: cum, avgShortfallBps: cum / BigInt(Math.max(strikes, 1)), lastStrikeAt: event.block.timestamp };
      context.Strike.set({
        id: `${eid(event)}_probe`,
        pool_id: lc(event.params.poolId),
        hook_id: hook.id,
        quotedOut: event.params.quotedOut,
        settledOut: event.params.settledOut,
        shortfallBps: Number(shortfallBps(event.params.quotedOut, event.params.settledOut)),
        execFailed: false,
        txHash: event.transaction.hash,
        ts: event.block.timestamp,
      });
    }
    context.Hook.set(next);
    context.Probe.set({
      id: eid(event),
      pool_id: lc(event.params.poolId),
      hook_id: hook.id,
      probeSender: lc(event.params.probeSender),
      amountIn: event.params.amountIn,
      quotedOut: event.params.quotedOut,
      settledOut: event.params.settledOut,
      shortfallBps: Number(shortfallBps(event.params.quotedOut, event.params.settledOut)),
      strike: event.params.strike,
      txHash: event.transaction.hash,
      ts: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "Scoreboard", event: "StatusChanged", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const hook = await getOrCreateHook(context, event.params.hook);
    const newStatus = STATUS_NAMES[Number(event.params.newStatus)] ?? "UNRATED";
    context.Hook.set({ ...hook, status: newStatus });
    context.StatusChange.set({
      id: eid(event),
      hook_id: hook.id,
      oldStatus: STATUS_NAMES[Number(event.params.oldStatus)] ?? "UNRATED",
      newStatus,
      reason: decodeReason(event.params.reason),
      ts: event.block.timestamp,
    });
  },
);

// ---------------------------------------------------------------- FirmRouter
indexer.onEvent(
  { contract: "FirmRouter", event: "Filled", fields: { transaction: ["hash"], block: ["timestamp"] } },
  async ({ event, context }) => {
    const hook = lc(event.params.hook);
    context.Fill.set({
      id: eid(event),
      pool_id: lc(event.params.poolId),
      hook_id: hook === ZERO_ADDRESS ? undefined : hook,
      user: lc(event.params.user),
      amountIn: event.params.amountIn,
      quotedOut: event.params.quotedOut,
      settledOut: event.params.settledOut,
      legIndex: Number(event.params.legIndex),
      txHash: event.transaction.hash,
      ts: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "FirmRouter", event: "LegSkipped", fields: { transaction: ["hash"], block: ["timestamp"] } },
  async ({ event, context }) => {
    const hook = lc(event.params.hook);
    context.Skip.set({
      id: eid(event),
      pool_id: lc(event.params.poolId),
      hook_id: hook === ZERO_ADDRESS ? undefined : hook,
      reason: Number(event.params.reason),
      txHash: event.transaction.hash,
      ts: event.block.timestamp,
    });
  },
);

// Rejected, NoFill and ProbeDone are covered by the Scoreboard's StrikeRecorded / ProbeRecorded (which carry the same
// numbers and are emitted in the same transaction). They are declared in config.yaml so a deployment's event stream is
// complete; they need no entity of their own.
indexer.onEvent({ contract: "FirmRouter", event: "Rejected" }, async () => {});
indexer.onEvent({ contract: "FirmRouter", event: "NoFill" }, async () => {});
indexer.onEvent({ contract: "CanaryRunner", event: "ProbeDone" }, async () => {});

void ALL_HOOK_MASK;
