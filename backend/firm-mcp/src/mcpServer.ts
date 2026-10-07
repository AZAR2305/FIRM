import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolError, type Toolbox } from "./toolbox";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) }] });
const fail = (e: unknown) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: e instanceof ToolError ? e.message : `unexpected error: ${(e as Error).message.split("\n")[0]}` }],
});

const address = z.string().describe("0x-prefixed 20-byte token address");
const amount = z.string().describe("amount in whole tokens as a decimal string, e.g. \"1000\" or \"12.5\"");

export interface ServerOptions {
  /** register raw_swap, the UNPROTECTED comparator (benchmark mode only) */
  enableRawSwap?: boolean;
}

export const TOOL_NAMES = ["list_pools", "get_hook_score", "quote", "firm_swap"] as const;

/**
 * The FIRM tool server (spec 11.2). It exposes what an autonomous trader needs and nothing that weakens protection:
 * the only swap tool by default is firm_swap, which goes through FirmRouter. raw_swap exists solely so the arena can
 * measure the unprotected agent, is off unless FIRM_MCP_ENABLE_RAW=1, and labels its output as unprotected.
 */
export function createFirmMcpServer(box: Toolbox, opts: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "firm", version: "0.1.0" });

  server.registerTool(
    "list_pools",
    {
      title: "List pools",
      description:
        "List Uniswap v4 pools on Monad Testnet for a token pair, with each pool's hook, fee, whether it has liquidity, and the hook's public FIRM rating (UNRATED, NORMAL, WATCH, BLOCKED).",
      inputSchema: { tokenIn: address, tokenOut: address },
    },
    async (a) => box.listPools(a).then(text, fail),
  );

  server.registerTool(
    "get_hook_score",
    {
      title: "Hook score",
      description:
        "The public honesty record of one hook: status, fills, strikes, probes, average shortfall (basis points between quoted and delivered output), permission flags, and the latest canary report if any.",
      inputSchema: { hook: address.describe("0x-prefixed hook address") },
    },
    async (a) => box.getHookScore(a).then(text, fail),
  );

  server.registerTool(
    "quote",
    {
      title: "Quote",
      description:
        "Ordered candidate routes for swapping `amount` of tokenIn to tokenOut, best quoted output first, with each route's quote, the floor FIRM enforces, and the hook's status. A quote is a claim by the pool, not a guarantee.",
      inputSchema: { tokenIn: address, tokenOut: address, amount },
    },
    async (a) => box.quote(a).then(text, fail),
  );

  server.registerTool(
    "firm_swap",
    {
      title: "Protected swap",
      description:
        "Swap through FIRM's FirmRouter. Routes are tried best quote first; any pool that delivers less than its in-transaction quote is reverted, publicly struck and skipped, and the next pool is tried. If no pool honours its quote the tokens are returned. Returns the transaction hash, what was received, and which legs were rejected.",
      inputSchema: { tokenIn: address, tokenOut: address, amount, minOut: amount.optional().describe("optional minimum acceptable output in whole tokens") },
    },
    async (a) => box.firmSwap(a).then(text, fail),
  );

  if (opts.enableRawSwap) {
    server.registerTool(
      "raw_swap",
      {
        title: "Raw swap (UNPROTECTED, benchmark only)",
        description:
          "UNPROTECTED comparator for benchmarking: executes exactly one pool with no quote check and no fallback, like a naive aggregator trusting the best quote. Takes a poolId from a recent quote.",
        inputSchema: { poolId: z.string().describe("poolId from quote"), tokenIn: address, tokenOut: address, amount },
      },
      async (a) => box.rawSwap(a).then(text, fail),
    );
  }

  return server;
}
