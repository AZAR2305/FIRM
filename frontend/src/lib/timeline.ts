import { parseEventLogs, type Abi, type Address, type Hex, type Log } from "viem";
import { fmt, pct, shortAddress, shortfallBps } from "./format";
import { SKIP_REASONS } from "./status";

export type StepKind = "skipped" | "rejected" | "filled" | "nofill" | "raw";

export interface TimelineStep {
  kind: StepKind;
  /** one readable line (spec 12.4) */
  text: string;
  poolId?: Hex;
  hook?: Address;
  /** amount delivered to the user (filled / raw steps), 18 decimals */
  amount?: bigint;
}

/** pool id (lowercase) -> friendly name such as "B" */
export type PoolNames = ReadonlyMap<string, string>;

const label = (poolId: Hex, names?: PoolNames) => `Pool ${names?.get(poolId.toLowerCase()) ?? poolId.slice(0, 10)}`;

const SKIP_TEXT = (hook: Address): Record<string, string> => ({
  BLOCKED: `hook ${shortAddress(hook)} is BLOCKED`,
  UNRATED_CAP: `hook ${shortAddress(hook)} is UNRATED and the trade is above its cap`,
  QUOTE_FAILED: "it could not be quoted",
  BELOW_MIN_OUT: "even an honest fill could not meet your minimum",
  ADVERTISED_MISMATCH: "its in-transaction quote was below the quote it advertised off-chain",
});

/**
 * Spec 12.4. Turns the FirmRouter events of one receipt, in log order, into readable lines. A deterministic template, never an
 * LLM, so it is safe to show next to money. With the RawRouter ABI it also describes RawSwap (the unprotected comparator).
 */
export function describeLogs(
  logs: readonly Log[],
  firmAbi: Abi,
  rawAbi: Abi,
  names?: PoolNames,
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const parsed = [
    ...parseEventLogs({ abi: firmAbi, logs: logs as Log[], strict: false }),
    ...parseEventLogs({ abi: rawAbi, logs: logs as Log[], strict: false }),
  ].sort((a, b) => Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0));

  for (const l of parsed) {
    const args = (l as unknown as { args: Record<string, unknown> }).args;
    switch (l.eventName) {
      case "LegSkipped": {
        const poolId = args.poolId as Hex;
        const hook = args.hook as Address;
        const why = SKIP_REASONS[Number(args.reason)] ?? `reason ${String(args.reason)}`;
        steps.push({ kind: "skipped", poolId, hook, text: `Skipped ${label(poolId, names)}: ${SKIP_TEXT(hook)[why] ?? why}.` });
        break;
      }
      case "Rejected": {
        const poolId = args.poolId as Hex;
        const quoted = args.quotedOut as bigint;
        const settled = args.settledOut as bigint;
        steps.push({
          kind: "rejected",
          poolId,
          hook: args.hook as Address,
          text: args.execFailed
            ? `${label(poolId, names)} quoted ${fmt(quoted, 1)} but the swap failed. Rejected, strike recorded.`
            : `${label(poolId, names)} quoted ${fmt(quoted, 1)}, delivered ${fmt(settled, 1)} (-${pct(shortfallBps(quoted, settled))}). Rejected, strike recorded.`,
        });
        break;
      }
      case "Filled": {
        const poolId = args.poolId as Hex;
        const quoted = args.quotedOut as bigint;
        const settled = args.settledOut as bigint;
        const sf = shortfallBps(quoted, settled);
        steps.push({
          kind: "filled",
          poolId,
          hook: args.hook as Address,
          amount: settled,
          text: `Filled via ${label(poolId, names)}: received ${fmt(settled, 1)} (${sf === 0n ? "matches quote" : `${pct(sf)} below quote, within tolerance`}).`,
        });
        break;
      }
      case "NoFill":
        steps.push({ kind: "nofill", text: "No pool honoured its quote. Your tokens were returned." });
        break;
      case "RawSwap": {
        const poolId = args.poolId as Hex;
        steps.push({
          kind: "raw",
          poolId,
          hook: args.hook as Address,
          amount: args.amountOut as bigint,
          text: `Raw router swapped through ${label(poolId, names)} with no check: received ${fmt(args.amountOut as bigint, 1)}. Nothing was compared with a quote and nothing was recorded.`,
        });
        break;
      }
    }
  }
  return steps;
}
