import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface ToolInfo {
  name: string;
  description: string;
  /** JSON Schema of the arguments, straight from the MCP server */
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** What the agent needs from a tool provider. The real one is an MCP client; tests can supply anything. */
export interface ToolSource {
  tools(): Promise<ToolInfo[]>;
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

/** Tool provider backed by the firm-mcp server over any MCP transport (stdio in production, in-memory in tests). */
export class McpToolSource implements ToolSource {
  private readonly client = new Client({ name: "firm-trader-agent", version: "0.1.0" });
  private connected?: Promise<void>;

  constructor(private readonly transport: Transport) {}

  private connect() {
    return (this.connected ??= this.client.connect(this.transport));
  }

  async tools(): Promise<ToolInfo[]> {
    await this.connect();
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown> }));
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    await this.connect();
    const r = (await this.client.callTool({ name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    const text = (r.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
    return { text, isError: r.isError === true };
  }

  close() {
    return this.client.close();
  }
}

/** Spawn firm-mcp as a child process and talk to it over stdio. `env` is merged over the current environment. */
export function stdioTransport(command: string, args: string[], cwd: string, env: Record<string, string>): StdioClientTransport {
  return new StdioClientTransport({
    command,
    args,
    cwd,
    env: { ...(process.env as Record<string, string>), ...env },
    stderr: "inherit",
  });
}

/** A restricted view of a source: the agent only sees (and can only call) the allowed tools. */
export function restrict(source: ToolSource, allowed: readonly string[]): ToolSource {
  const ok = new Set(allowed);
  return {
    tools: async () => (await source.tools()).filter((t) => ok.has(t.name)),
    call: async (name, args) =>
      ok.has(name) ? source.call(name, args) : { text: `tool "${name}" is not available to this agent`, isError: true },
    close: () => source.close(),
  };
}
