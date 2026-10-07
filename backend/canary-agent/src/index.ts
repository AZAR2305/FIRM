import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { createLogger, createRpcPool, endpointsFromEnv, loadDeployments, monadTestnet, readHookStats } from "@firm/shared";
import { CanaryAgent, defaultOptions } from "./agent";
import { discoverFromChain, staticPools, type PoolRecord } from "./discover";
import { llmConfigFromEnv } from "./llm";
import { ChainProbeExecutor } from "./prober";
import { Store } from "./store";

const env = z
  .object({
    CANARY_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "CANARY_PRIVATE_KEY must be a 0x-prefixed 32-byte hex testnet key"),
    CANARY_STATE_PATH: z.string().default("./canary-state.json"),
    REPORTS_DIR: z.string().default("./reports"),
    CANARY_POLL_SECONDS: z.coerce.number().int().positive().default(60),
    CANARY_REPROBE_HOURS: z.coerce.number().positive().default(6),
    CANARY_STOP_ON_BLOCKED: z.enum(["true", "false"]).default("true"),
    CANARY_PROBE_DELAY_MS: z.coerce.number().int().min(0).default(0),
    CANARY_SCAN_CHAIN: z.enum(["true", "false"]).default("true"),
  })
  .parse(process.env);

const log = createLogger("canary-agent");
const dep = loadDeployments();
const rpc = createRpcPool();
const account = privateKeyToAccount(env.CANARY_PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(endpointsFromEnv()[0]!.url) });
const store = new Store(env.CANARY_STATE_PATH);

const agent = new CanaryAgent(
  {
    exec: new ChainProbeExecutor(rpc.client, wallet, dep, log),
    hookInfo: async (hook) => ({
      stats: await readHookStats(rpc.client, dep.core.scoreboard.address, hook),
      bytecode: (await rpc.client.getCode({ address: hook })) ?? "0x",
    }),
    store,
    log,
    llm: llmConfigFromEnv(),
  },
  {
    ...defaultOptions(env.REPORTS_DIR),
    reprobeIntervalSec: Math.round(env.CANARY_REPROBE_HOURS * 3600),
    stopOnBlocked: env.CANARY_STOP_ON_BLOCKED === "true",
    probeDelayMs: env.CANARY_PROBE_DELAY_MS,
  },
);

async function pools(): Promise<PoolRecord[]> {
  const byId = new Map<string, PoolRecord>();
  for (const p of staticPools(dep)) byId.set(p.poolId.toLowerCase(), p);
  if (env.CANARY_SCAN_CHAIN === "true") {
    for (const p of await discoverFromChain(rpc.client, dep, store, log)) byId.set(p.poolId.toLowerCase(), p);
  }
  // pools found by earlier scans (the scan cursor only moves forward)
  for (const p of store.knownPools()) byId.set(p.poolId.toLowerCase(), p);
  return [...byId.values()];
}

async function cycle() {
  const list = await pools();
  const { probesSent, reports } = await agent.runOnce(list);
  log.info("cycle done", { pools: list.length, probesSent, reports: reports.length });
}

const cmd = process.argv[2] ?? "once";
log.info("canary-agent starting", { cmd, wallet: account.address });
if (cmd === "once") {
  await cycle();
} else if (cmd === "watch") {
  for (;;) {
    try {
      await cycle();
    } catch (e) {
      log.error("cycle failed", { err: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, env.CANARY_POLL_SECONDS * 1000));
  }
} else {
  console.error("usage: canary-agent [once|watch]");
  process.exit(2);
}
