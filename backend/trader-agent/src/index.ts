import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  Erc20Abi,
  MockTokenAbi,
  ScoreboardAbi,
  createLogger,
  createRpcPool,
  endpointsFromEnv,
  loadDeployments,
  monadTestnet,
  waitForReceipt,
} from "@firm/shared";
import { runArena } from "./arena";
import { llmConfigFromEnv } from "./llmAgent";
import { McpToolSource, stdioTransport } from "./toolSource";

const here = dirname(fileURLToPath(import.meta.url));
const env = z
  .object({
    TRADER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "TRADER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex testnet key"),
    QUOTE_API_URL: z.string().url().default("http://localhost:8787"),
    ARENA_TRIALS: z.coerce.number().int().positive().default(20),
    ARENA_OUTPUT: z.string().default(join(here, "..", "results", "arena.json")),
    /** deployer / Scoreboard owner key: lets the arena reinstate the villain hook so every trial is a first encounter */
    ARENA_OWNER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  })
  .parse(process.env);

const log = createLogger("trader-agent");
const dep = loadDeployments();
if (!dep.fixtures || !dep.pools) throw new Error("deployment has no fixtures/pools: run the full Redeploy.sh first");
const rpc = createRpcPool();
const url = endpointsFromEnv()[0]!.url;
const trader = privateKeyToAccount(env.TRADER_PRIVATE_KEY as `0x${string}`);
const traderWallet = createWalletClient({ account: trader, chain: monadTestnet, transport: http(url) });
const tokenIn = dep.fixtures.tUSD.address;
const tokenOut = dep.fixtures.tUSDC.address;
const villain = dep.pools.list.B?.hook;

async function ensureTraderTokens(whole: bigint) {
  const need = whole * 10n ** 18n;
  for (let bal = await rpc.client.readContract({ address: tokenIn, abi: Erc20Abi, functionName: "balanceOf", args: [trader.address] }); bal < need; ) {
    const hash = await traderWallet.writeContract({ address: tokenIn, abi: MockTokenAbi, functionName: "mint", args: [trader.address, 10_000n * 10n ** 18n], gas: 150_000n });
    await waitForReceipt(rpc.client, hash);
    bal += 10_000n * 10n ** 18n;
  }
}

async function reinstateVillain() {
  if (!env.ARENA_OWNER_PRIVATE_KEY || !villain) return;
  const owner = privateKeyToAccount(env.ARENA_OWNER_PRIVATE_KEY as `0x${string}`);
  const status = await rpc.client.readContract({ address: dep.core.scoreboard.address, abi: ScoreboardAbi, functionName: "statusOf", args: [villain] });
  if (Number(status) !== 3) return; // not BLOCKED
  const w = createWalletClient({ account: owner, chain: monadTestnet, transport: http(url) });
  const hash = await w.writeContract({ address: dep.core.scoreboard.address, abi: ScoreboardAbi, functionName: "reinstate", args: [villain], gas: 200_000n });
  await waitForReceipt(rpc.client, hash);
}

// spawn firm-mcp over stdio (stdout is the protocol channel, so run tsx directly rather than through pnpm)
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const source = new McpToolSource(
  stdioTransport(process.execPath, [tsx, "src/server.ts"], join(here, "..", "..", "firm-mcp"), {
    QUOTE_API_URL: env.QUOTE_API_URL,
    TRADER_PRIVATE_KEY: env.TRADER_PRIVATE_KEY,
    FIRM_MCP_ENABLE_RAW: "1", // the arena needs the unprotected comparator; each agent only sees its own tools
  }),
);

const amounts = Array.from({ length: env.ARENA_TRIALS }, (_, i) => String(100 + ((i * 100) % 1900)));
const llm = llmConfigFromEnv();
log.info(llm ? "running the arena with an LLM trader" : "no LLM endpoint configured: running the SCRIPTED trader (results are labelled mode=scripted)", {
  model: llm?.model ?? null,
  trials: amounts.length,
  trader: trader.address,
});

try {
  await ensureTraderTokens(BigInt(amounts.reduce((a, b) => a + Number(b), 0)) * 2n);
  const result = await runArena({
    source,
    llm,
    tokenIn,
    tokenOut,
    amounts,
    beforeTrial: reinstateVillain,
    log: (m) => log.info(m),
  });
  mkdirSync(dirname(env.ARENA_OUTPUT), { recursive: true });
  writeFileSync(env.ARENA_OUTPUT, JSON.stringify(result, null, 2));
  log.info("arena finished", { output: env.ARENA_OUTPUT, summary: result.summary });
} finally {
  await source.close();
}
