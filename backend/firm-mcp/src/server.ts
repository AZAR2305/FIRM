import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRpcPool, endpointsFromEnv, loadDeployments, monadTestnet } from "@firm/shared";
import { createFirmMcpServer } from "./mcpServer";
import { Toolbox } from "./toolbox";

// stdout is the MCP protocol channel: log to stderr only.
const env = z
  .object({
    QUOTE_API_URL: z.string().url().default("http://localhost:8787"),
    TRADER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    FIRM_MCP_ENABLE_RAW: z.enum(["0", "1"]).default("0"),
  })
  .parse(process.env);

const dep = loadDeployments();
const rpc = createRpcPool();
const wallet = env.TRADER_PRIVATE_KEY
  ? createWalletClient({ account: privateKeyToAccount(env.TRADER_PRIVATE_KEY as `0x${string}`), chain: monadTestnet, transport: http(endpointsFromEnv()[0]!.url) })
  : undefined;

const server = createFirmMcpServer(new Toolbox({ quoteApiUrl: env.QUOTE_API_URL, client: rpc.client, dep, wallet }), {
  enableRawSwap: env.FIRM_MCP_ENABLE_RAW === "1",
});
await server.connect(new StdioServerTransport());
console.error(`firm-mcp ready (wallet: ${wallet ? wallet.account.address : "none, read-only"}, raw_swap: ${env.FIRM_MCP_ENABLE_RAW === "1" ? "ENABLED (benchmark mode)" : "off"})`);
