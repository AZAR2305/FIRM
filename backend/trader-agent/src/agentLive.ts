// A live, readable run of the LLM trading agent for demos: one swap through FIRM's MCP tools on Monad Testnet, printing each tool
// call the model makes as it happens. The model only chooses tools; FirmRouter decides what executes.
//
//   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... TRADER_PRIVATE_KEY=0x... QUOTE_API_URL=http://localhost:8787 npx tsx src/agentLive.ts 100
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployments } from "@firm/shared";
import { FIRM_TOOLS, outcomeOf } from "./arena";
import { llmConfigFromEnv, runLlmTrader } from "./llmAgent";
import { McpToolSource, restrict, stdioTransport, type ToolSource } from "./toolSource";

const here = dirname(fileURLToPath(import.meta.url));
const amount = process.argv[2] ?? "100";
const llm = llmConfigFromEnv();
if (!llm) throw new Error("set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL");
if (!process.env.TRADER_PRIVATE_KEY) throw new Error("set TRADER_PRIVATE_KEY (a testnet key)");
const dep = loadDeployments();
if (!dep.fixtures) throw new Error("deployment has no fixtures");

const c = { dim: "\x1b[2m", mauve: "\x1b[38;2;201;160;240m", ok: "\x1b[38;2;62;207;142m", bad: "\x1b[38;2;255;107;107m", bold: "\x1b[1m", off: "\x1b[0m" };
const short = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n)}…` : s);

const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const mcp = new McpToolSource(
  stdioTransport(process.execPath, [tsx, "src/server.ts"], join(here, "..", "..", "firm-mcp"), {
    QUOTE_API_URL: process.env.QUOTE_API_URL ?? "http://localhost:8787",
    TRADER_PRIVATE_KEY: process.env.TRADER_PRIVATE_KEY,
  }),
);

// print every tool call and its result as it happens
const live: ToolSource = {
  tools: () => mcp.tools(),
  close: () => mcp.close(),
  async call(name, args) {
    console.log(`${c.mauve}→ model calls ${c.bold}${name}${c.off}${c.mauve} ${short(JSON.stringify(args))}${c.off}`);
    const r = await mcp.call(name, args);
    console.log(`${r.isError ? c.bad : c.dim}← ${short(r.text.replace(/\s+/g, " "), 220)}${c.off}`);
    return r;
  },
};

console.log(`${c.bold}AI trading agent${c.off} · model ${llm.model} · tools: ${FIRM_TOOLS.join(", ")} (MCP, through FirmRouter)`);
console.log(`${c.dim}task: swap ${amount} tUSD to tUSDC at the best price${c.off}\n`);
try {
  const task = `Swap ${amount} tUSD to tUSDC. tUSD is ${dep.fixtures.tUSD.address}. tUSDC is ${dep.fixtures.tUSDC.address}.`;
  const trace = await runLlmTrader({ llm, source: restrict(live, FIRM_TOOLS), task });
  const o = outcomeOf(trace, 18);
  console.log("");
  if (o.ok) console.log(`${c.ok}${c.bold}✓ filled through FIRM:${c.off}${c.ok} received ${o.received} tUSDC · rejected legs ${o.rejectedLegs} · tx ${o.txHash}${c.off}`);
  else console.log(`${c.bad}✗ no fill: ${o.error ?? "the model did not complete a swap"}${c.off}`);
  if (trace.finalText) console.log(`${c.dim}model: ${short(trace.finalText.replace(/\s+/g, " "), 300)}${c.off}`);
} finally {
  await live.close();
}
