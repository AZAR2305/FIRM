import { shortfallBps } from "@firm/shared";
import { E18 } from "../ctx";
import { pct, type ExperimentResult } from "../stats";
import { PROBE_AMOUNTS, PROBE_SENDERS, type Experiment } from "./types";

const HOOKS: [pool: string, fixture: string][] = [
  ["B", "FixtureContextHook"],
  ["D", "FixtureRandomFeeHook"],
  ["E", "FixtureSenderAwareHook"],
  ["G", "FixtureGasGriefHook"],
  ["R", "FixtureRevertHook"],
];

/**
 * B1 Detection by hook. For each fixture: (1) canary probes from the starting status until BLOCKED or the 12-probe
 * matrix is exhausted; (2) ground truth from the UNPROTECTED RawRouter: how often does a real execution deliver less
 * than the quote by more than 10 bps?; (3) N FirmRouter swaps, one pool only, hook reinstated between trials so every
 * trial is a first encounter: how often is a strike recorded?
 */
export const b1: Experiment = async (ctx, cfg): Promise<ExperimentResult> => {
  const dust = 10n * E18;
  await ctx.fund(2000n * E18);
  const rows: (string | number)[][] = [];
  const notes: string[] = [];

  for (const [pool, fixture] of HOOKS) {
    const hook = ctx.hook(pool);
    const startStatus = await ctx.status(hook);

    // (1) canary probes
    await ctx.reinstateIfBlocked(hook);
    let probesToBlock: number | string = "not blocked";
    let n = 0;
    outer: for (const amt of PROBE_AMOUNTS) {
      for (const idx of PROBE_SENDERS) {
        await ctx.probe(pool, amt, idx);
        n++;
        if ((await ctx.status(hook)) === "BLOCKED") {
          probesToBlock = n;
          break outer;
        }
      }
    }
    const statusAfterProbes = await ctx.status(hook);

    // (2) ground truth through the unprotected router
    let deviating = 0;
    for (let i = 0; i < cfg.trials; i++) {
      const q = await ctx.quote(pool, dust);
      let out = 0n;
      try {
        out = (await ctx.rawSwap(pool, dust)).out;
      } catch {
        out = 0n; // a reverting or gas-griefing hook: the unprotected router simply fails
      }
      if (shortfallBps(q, out) > 10n) deviating++;
    }

    // (3) FirmRouter trials, each a first encounter
    let struck = 0;
    let filled = 0;
    for (let i = 0; i < cfg.trials; i++) {
      await ctx.reinstateIfBlocked(hook);
      const r = await ctx.firmSwap([ctx.route(pool)], dust);
      if (r.events.rejected.length > 0) struck++;
      if (r.events.filled) filled++;
    }
    const catchRate = deviating === 0 ? "n/a" : pct(Math.min(struck, deviating), deviating);
    rows.push([
      `${pool} ${fixture}`,
      startStatus,
      probesToBlock,
      statusAfterProbes,
      `${deviating}/${cfg.trials}`,
      `${struck}/${cfg.trials}`,
      `${filled}/${cfg.trials}`,
      catchRate,
    ]);
  }

  notes.push(
    "Deviation is measured on the unprotected RawRouter against the Quoter's quote, with a 10 bps tolerance (the NORMAL/UNRATED tolerance).",
    "FirmRouter trials use a single pool per swap so a rejection is attributable; the hook is reinstated (owner) before each trial so every trial is a first encounter.",
    "catch rate = strikes recorded / deviating executions, capped at 100%. For probabilistic hooks (D) the router trial and the raw trial draw independent randomness, so the two rates agree only statistically.",
    "FixtureSenderAwareHook (E) is honest toward the Quoter and FirmRouter, so the router never strikes it (catch rate 0% through the router); it is caught by canary probes from other sender identities (see probes-to-block and B4).",
    "Fixtures are our own contracts: this shows the mechanism works, not that real malicious hooks are caught.",
  );
  return {
    id: "B1",
    title: "Detection by hook",
    method: `For each fixture hook: canary probes (3 amounts x 4 senders, until BLOCKED), then ${cfg.trials} unprotected RawRouter executions (ground truth), then ${cfg.trials} FirmRouter swaps on that single pool with the hook reinstated before each trial. 10-token dust trades.`,
    tables: [
      {
        table: {
          headers: ["Hook", "Start status", "Probes to BLOCKED", "Status after probes", "Raw deviating", "Router strikes", "Router fills", "Catch rate (router)"],
          rows,
        },
      },
    ],
    notes,
  };
};
