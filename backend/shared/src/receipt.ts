import { parseEventLogs, type Address, type Hex, type Log } from "viem";
import { FirmRouterAbi } from "./abis/FirmRouter";
import { fmt18, shortfallBps } from "./math";
import { SKIP_REASONS } from "./types";

export type StepKind = "skipped" | "rejected" | "filled" | "nofill";

export interface TimelineStep {
  kind: StepKind;
  /** one readable line, e.g. "Pool B quoted 999.0 but delivered 819.2 (-18.0%). Rejected, strike recorded." */
  text: string;
  poolId?: Hex;
  hook?: Address;
}

/** Friendly pool names by pool id (lowercase). Falls back to a short id. */
export type PoolNames = ReadonlyMap<string, string>;

const label = (poolId: Hex, names?: PoolNames) => `Pool ${names?.get(poolId.toLowerCase()) ?? poolId.slice(0, 10)}`;
const short = (a: Address) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const pct = (bps: bigint) => `${(Number(bps) / 100).toFixed(1)}%`;

/**
 * receipt-writer (spec 11.3): turns FirmRouter's LegSkipped / Rejected / Filled / NoFill events, in log order, into one
 * readable line each. Deterministic template, never an LLM, so it is safe to show next to money. It is the logic behind
 * the swap timeline (spec 12.4).
 */
export function describeFirmLogs(logs: readonly Log[], names?: PoolNames): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (const l of parseEventLogs({ abi: FirmRouterAbi, logs: logs as Log[] })) {
    switch (l.eventName) {
      case "LegSkipped": {
        const { poolId, hook, reason } = l.args;
        const why = SKIP_REASONS[reason] ?? `reason ${reason}`;
        const detail: Record<string, string> = {
          BLOCKED: `hook ${short(hook)} is BLOCKED`,
          UNRATED_CAP: `hook ${short(hook)} is UNRATED and the trade is above its cap`,
          QUOTE_FAILED: "it could not be quoted",
          BELOW_MIN_OUT: "even an honest fill could not meet your minimum",
          ADVERTISED_MISMATCH: "its in-transaction quote was below the quote it advertised off-chain",
        };
        steps.push({ kind: "skipped", poolId, hook, text: `Skipped ${label(poolId, names)}: ${detail[why] ?? why}.` });
        break;
      }
      case "Rejected": {
        const { poolId, hook, quotedOut, settledOut, execFailed } = l.args;
        steps.push({
          kind: "rejected",
          poolId,
          hook,
          text: execFailed
            ? `${label(poolId, names)} quoted ${fmt18(quotedOut, 1)} but the swap failed. Rejected, strike recorded.`
            : `${label(poolId, names)} quoted ${fmt18(quotedOut, 1)} but delivered ${fmt18(settledOut, 1)} (-${pct(shortfallBps(quotedOut, settledOut))}). Rejected, strike recorded.`,
        });
        break;
      }
      case "Filled": {
        const { poolId, hook, quotedOut, settledOut } = l.args;
        const sf = shortfallBps(quotedOut, settledOut);
        steps.push({
          kind: "filled",
          poolId,
          hook,
          text: `Filled via ${label(poolId, names)}: received ${fmt18(settledOut, 1)} (${sf === 0n ? "matches quote" : `${pct(sf)} below quote, within tolerance`}).`,
        });
        break;
      }
      case "NoFill":
        steps.push({ kind: "nofill", text: "No pool honoured its quote. Your tokens were returned." });
        break;
    }
  }
  return steps;
}

export type { Hex };
