import { parseUnits } from "viem";
import { shortfallBps } from "@firm/shared";
import { runLlmTrader, runScriptedTrader, type AgentTrace, type LlmConfig } from "./llmAgent";
import { restrict, type ToolSource } from "./toolSource";

/** Tools each arm may use (spec 11.2): the unprotected agent gets raw_swap, the protected agent gets firm_swap. */
export const RAW_TOOLS = ["list_pools", "quote", "raw_swap"] as const;
export const FIRM_TOOLS = ["list_pools", "quote", "firm_swap"] as const;

export interface Outcome {
  ok: boolean;
  tool: string | null;
  /** pool the swap went through (raw) or null (firm: see rejectedLegs) */
  pool: string | null;
  /** best quote the agent saw before trading: the promise it acted on */
  bestQuote: string | null;
  /** the quote of the leg that actually paid out */
  paidLegQuote: string | null;
  received: string;
  /** shortfall of what was received vs the quote of the leg that paid (hidden fees show up here) */
  hiddenLossBps: number;
  /** received vs the best quote the agent saw (the hidden loss plus the honest pool's worse price) */
  costVsBestQuoteBps: number;
  txHash: string | null;
  rejectedLegs: number;
  steps: number;
  error?: string;
}

export interface ArenaRun {
  i: number;
  amountIn: string;
  unprotected: Outcome;
  protected: Outcome;
}

export interface ArenaResult {
  generatedAt: string;
  /** "llm" runs name the model; "scripted" runs never claim to be an LLM */
  mode: "llm" | "scripted";
  model: string | null;
  trials: number;
  runs: ArenaRun[];
  summary: {
    unprotected: ArmSummary;
    protected: ArmSummary;
  };
}

export interface ArmSummary {
  filled: number;
  /** sum over trades of (quote of the paying leg - received), in tokens */
  totalLossVsPaidQuote: string;
  meanHiddenLossBps: number;
  meanCostVsBestQuoteBps: number;
}

const fmt = (v: bigint, d: number) => {
  const s = (v < 0n ? -v : v).toString().padStart(d + 1, "0");
  const whole = s.slice(0, s.length - d);
  const frac = s.slice(s.length - d).replace(/0+$/, "");
  return `${v < 0n ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
};

function lastSwap(trace: AgentTrace) {
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const s = trace.steps[i]!;
    if (s.tool === "raw_swap" || s.tool === "firm_swap") return s;
  }
  return null;
}

/** Read what really happened out of the swap tool's result. Model prose is never used for numbers. */
export function outcomeOf(trace: AgentTrace, decimals = 18): Outcome {
  const blank: Outcome = {
    ok: false, tool: null, pool: null, bestQuote: bestQuoteHuman(trace), paidLegQuote: null, received: "0",
    hiddenLossBps: 0, costVsBestQuoteBps: 0, txHash: null, rejectedLegs: 0, steps: trace.steps.length,
  };
  const swap = lastSwap(trace);
  if (!swap) return { ...blank, error: "the agent never executed a swap" };
  if (swap.isError) return { ...blank, tool: swap.tool, error: swap.result.slice(0, 200) };

  let r: Record<string, any>;
  try {
    r = JSON.parse(swap.result);
  } catch {
    return { ...blank, tool: swap.tool, error: "unparseable swap result" };
  }
  const received = parseUnits(String(r.received ?? "0"), decimals);
  const paidQuote = r.quoted ?? r.quotedByFilledLeg ?? null;
  const paid = paidQuote != null ? parseUnits(String(paidQuote), decimals) : null;
  const bestHuman = bestQuoteHuman(trace);
  const bestWei = bestHuman != null ? parseUnits(bestHuman, decimals) : null;

  const filled = swap.tool === "raw_swap" ? true : r.filled === true;
  return {
    ok: filled,
    tool: swap.tool,
    pool: r.pool ?? null,
    bestQuote: bestHuman,
    paidLegQuote: paid != null ? fmt(paid, decimals) : null,
    received: fmt(received, decimals),
    hiddenLossBps: paid != null ? Number(shortfallBps(paid, received)) : 0,
    costVsBestQuoteBps: bestWei != null ? Number(shortfallBps(bestWei, received)) : 0,
    txHash: r.txHash ?? null,
    rejectedLegs: Array.isArray(r.rejectedLegs) ? r.rejectedLegs.length : 0,
    steps: trace.steps.length,
  };
}

/** the quote tool reports humanised numbers (e.g. "999"), keep them as such */
function bestQuoteHuman(trace: AgentTrace): string | null {
  for (const s of trace.steps) {
    if (s.tool !== "quote" || s.isError) continue;
    try {
      return (JSON.parse(s.result) as { routes: { quotedOut: string }[] }).routes[0]?.quotedOut ?? null;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function summarise(os: Outcome[], decimals: number): ArmSummary {
  const filled = os.filter((o) => o.ok);
  let loss = 0n;
  for (const o of filled) {
    if (o.paidLegQuote == null) continue;
    const q = parseUnits(o.paidLegQuote, decimals);
    const r = parseUnits(o.received, decimals);
    if (q > r) loss += q - r;
  }
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  return {
    filled: filled.length,
    totalLossVsPaidQuote: fmt(loss, decimals),
    meanHiddenLossBps: mean(filled.map((o) => o.hiddenLossBps)),
    meanCostVsBestQuoteBps: mean(filled.map((o) => o.costVsBestQuoteBps)),
  };
}

export interface ArenaOptions {
  source: ToolSource;
  /** null runs the scripted trader (fallback F6) */
  llm: LlmConfig | null;
  tokenIn: string;
  tokenOut: string;
  /** whole-token amounts, one per trial */
  amounts: string[];
  decimals?: number;
  /** called before each trial, e.g. to reinstate a BLOCKED hook so every trial is a first encounter */
  beforeTrial?: (i: number) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Run A (unprotected agent: list_pools, quote, raw_swap) and Run B (protected agent: list_pools, quote, firm_swap) on the
 * same trades. Both are honest but naive and prefer the best quote; only the tool differs.
 */
export async function runArena(o: ArenaOptions): Promise<ArenaResult> {
  const decimals = o.decimals ?? 18;
  const runs: ArenaRun[] = [];
  for (let i = 0; i < o.amounts.length; i++) {
    const amount = o.amounts[i]!;
    await o.beforeTrial?.(i);
    const task = `Swap ${amount} tUSD to tUSDC. tUSD is ${o.tokenIn}. tUSDC is ${o.tokenOut}.`;

    const arm = async (mode: "raw" | "firm") => {
      const view = restrict(o.source, mode === "raw" ? RAW_TOOLS : FIRM_TOOLS);
      try {
        const trace = o.llm
          ? await runLlmTrader({ llm: o.llm, source: view, task })
          : await runScriptedTrader({ source: view, mode, tokenIn: o.tokenIn, tokenOut: o.tokenOut, amount });
        return outcomeOf(trace, decimals);
      } catch (e) {
        return { ...outcomeOf({ mode: "scripted", steps: [], finalText: "", turns: 0, stoppedBy: "scripted" }, decimals), error: (e as Error).message.slice(0, 200) };
      }
    };

    const unprotected = await arm("raw");
    const protectedO = await arm("firm");
    runs.push({ i: i + 1, amountIn: amount, unprotected, protected: protectedO });
    o.log?.(`trade ${i + 1}/${o.amounts.length} (${amount} tUSD): unprotected got ${unprotected.received}, protected got ${protectedO.received}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: o.llm ? "llm" : "scripted",
    model: o.llm?.model ?? null,
    trials: runs.length,
    runs,
    summary: {
      unprotected: summarise(runs.map((r) => r.unprotected), decimals),
      protected: summarise(runs.map((r) => r.protected), decimals),
    },
  };
}
