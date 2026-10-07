import { createPublicClient, custom, fallback, http, type PublicClient, type Transport } from "viem";
import { DEFAULT_RPCS, monadTestnet } from "./chain";

/** Token bucket: at most `rps` calls per second, smoothly. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly rps: number) {
    this.tokens = rps;
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.rps, this.tokens + ((now - this.last) / 1000) * this.rps);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.tokens) / this.rps) * 1000)));
    }
  }
}

export interface RpcEndpoint {
  url: string;
  rps: number;
}

export interface RpcPool {
  client: PublicClient;
  /** URL of the endpoint that most recently answered successfully */
  inUse(): string | undefined;
  endpoints: RpcEndpoint[];
}

/** Parse MONAD_TESTNET_RPC_URLS (comma separated, primary first). Known endpoints keep their documented budgets. */
export function endpointsFromEnv(env: string | undefined = process.env.MONAD_TESTNET_RPC_URLS): RpcEndpoint[] {
  const urls = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (urls.length === 0) return DEFAULT_RPCS;
  const known = new Map(DEFAULT_RPCS.map((e) => [e.url, e.rps]));
  return urls.map((url) => ({ url, rps: known.get(url) ?? (url.includes("127.0.0.1") || url.includes("localhost") ? 1000 : 10) }));
}

/**
 * Viem client over several RPCs: each endpoint is rate limited to its budget and a failing endpoint falls over to
 * the next one (spec 10.3 / F5). An optional Alchemy URL is appended last.
 */
export function createRpcPool(endpoints: RpcEndpoint[] = endpointsFromEnv()): RpcPool {
  let lastOk: string | undefined;
  const all = [...endpoints];
  const alchemy = process.env.ALCHEMY_MONAD_TESTNET_URL;
  if (alchemy) all.push({ url: alchemy, rps: 10 });

  const transports: Transport[] = all.map((e) => {
    const limiter = new RateLimiter(e.rps);
    const inner = http(e.url, { retryCount: 0, timeout: 15_000 })({ chain: monadTestnet });
    return custom({
      async request(args: { method: string; params?: unknown }) {
        await limiter.take();
        const res = await inner.request(args as never);
        lastOk = e.url;
        return res;
      },
    });
  });

  const client = createPublicClient({
    chain: monadTestnet,
    transport: fallback(transports, { rank: false, retryCount: 1 }),
  }) as PublicClient;
  return { client, inUse: () => lastOk, endpoints: all };
}
