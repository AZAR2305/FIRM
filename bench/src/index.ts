import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createLogger, loadDeployments } from "@firm/shared";
import { Ctx } from "./ctx";
import { renderResults } from "./report";
import type { ExperimentResult } from "./stats";
import { b1 } from "./experiments/b1";
import { b2 } from "./experiments/b2";
import { b3 } from "./experiments/b3";
import { b4 } from "./experiments/b4";
import { b5 } from "./experiments/b5";
import { b6 } from "./experiments/b6";
import { b7 } from "./experiments/b7";
import { b8 } from "./experiments/b8";
import type { BenchConfig, Experiment } from "./experiments/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = z
  .object({
    BENCH_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "BENCH_PRIVATE_KEY must be the 0x-prefixed deployer (owner) testnet key"),
    BENCH_TRIALS: z.coerce.number().int().positive().default(20),
    BENCH_HONEST_EXECUTIONS: z.coerce.number().int().positive().default(100),
    BENCH_TRADE_TOKENS: z.coerce.bigint().positive().default(1000n),
    /** comma separated subset, e.g. B1,B3 */
    BENCH_ONLY: z.string().optional(),
    BENCH_OUTPUT: z.string().default("RESULTS.md"),
    QUOTE_API_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
    ENVIO_GRAPHQL_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  })
  .parse(process.env);

const log = createLogger("bench");
const dep = loadDeployments();
const ctx = new Ctx(dep, env.BENCH_PRIVATE_KEY as `0x${string}`);
const cfg: BenchConfig = {
  trials: env.BENCH_TRIALS,
  honestExecutions: env.BENCH_HONEST_EXECUTIONS,
  tradeTokens: env.BENCH_TRADE_TOKENS,
  quoteApiUrl: env.QUOTE_API_URL,
  envioUrl: env.ENVIO_GRAPHQL_URL,
};

// P0: B1 B2 B3 B5 B6; P1: B4 B7; P2: B8 (spec 13.2). B1 first: it needs hooks in their fresh state.
const ALL: [string, Experiment][] = [["B1", b1], ["B2", b2], ["B3", b3], ["B4", b4], ["B5", b5], ["B6", b6], ["B7", b7], ["B8", b8]];
const only = env.BENCH_ONLY?.split(",").map((s) => s.trim().toUpperCase());
const selected = ALL.filter(([id]) => !only || only.includes(id));

const t0 = Date.now();
const headStart = await ctx.client.getBlockNumber();
const results: ExperimentResult[] = [];
for (const [id, fn] of selected) {
  log.info("running experiment", { id });
  try {
    results.push(await fn(ctx, cfg));
  } catch (e) {
    log.error("experiment failed", { id, err: (e as Error).message });
    results.push({ id, title: "FAILED", method: "", tables: [], notes: [], skipped: `error: ${(e as Error).message}` });
  }
}

let commit = "unknown";
try {
  commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
  if (execSync("git status --porcelain", { cwd: root }).toString().trim()) commit += " (+ uncommitted changes)";
} catch {
  /* not a git checkout */
}

const md = renderResults(
  dep,
  {
    generatedAt: new Date().toISOString(),
    commit,
    chainId: await ctx.client.getChainId(),
    headBlockStart: headStart,
    headBlockEnd: await ctx.client.getBlockNumber(),
    localFork: ctx.isLocalFork,
    trials: cfg.trials,
    txCount: ctx.txCount,
    durationSec: (Date.now() - t0) / 1000,
    wallet: ctx.me,
  },
  results,
);
const outPath = isAbsolute(env.BENCH_OUTPUT) ? env.BENCH_OUTPUT : join(root, env.BENCH_OUTPUT);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md);
log.info("wrote results", { path: outPath, experiments: results.map((r) => `${r.id}${r.skipped ? " (skipped)" : ""}`) });
