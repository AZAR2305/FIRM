import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseEventLogs,
  parseUnits,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import {
  Erc20Abi,
  FirmRouterAbi,
  RawRouterAbi,
  describeFirmLogs,
  shortfallBps,
  waitForReceipt,
  type Deployments,
  type RouteT,
} from "@firm/shared";

/** Shape of one route in the quote-api /route response (amounts as decimal strings). */
export interface ApiRoute {
  poolId: Hex;
  description?: string;
  zeroForOne: boolean;
  quotedOut: string;
  status: string;
  toleranceBps: number;
  floor: string;
  key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
}

interface ApiRouteResponse {
  routes: ApiRoute[];
  skipped: { poolId: Hex; hook: Address; reason: string }[];
  calldataRoutes: (Omit<RouteT, "advertisedOut"> & { advertisedOut: string })[];
}

export interface ToolboxDeps {
  /** base URL of quote-api, e.g. http://localhost:8787 */
  quoteApiUrl: string;
  client: PublicClient;
  dep: Deployments;
  /** needed for firm_swap / raw_swap; a testnet-only wallet */
  wallet?: WalletClient<Transport, Chain, Account>;
  fetchFn?: typeof fetch;
  /** gas LIMITS (Monad charges the limit, so these are explicit and not generous) */
  gasFirmSwap?: bigint;
  gasRawSwap?: bigint;
}

/** A tool-level failure with a message that is safe to show to a model. */
export class ToolError extends Error {}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Everything an agent can do with FIRM, as plain async methods (spec 11.2). The MCP server and the trader-agent are thin
 * layers over this. Note what is NOT here: no tool lets a caller skip FirmRouter's checks, and `rawSwap` (the unprotected
 * comparator) is only registered on the MCP server when explicitly enabled for benchmark runs.
 */
export class Toolbox {
  private readonly fetchFn: typeof fetch;
  private readonly decimals = new Map<string, number>();
  /** routes seen in the latest quote, by pool id: what raw_swap executes */
  private lastRoutes = new Map<string, { api: ApiRoute; call: RouteT }>();
  /** friendly names for the timeline text */
  private poolNames = new Map<string, string>();

  constructor(private readonly d: ToolboxDeps) {
    this.fetchFn = d.fetchFn ?? fetch;
  }

  // ------------------------------------------------------------------ read-only tools
  /** pools for a pair, with hook, status, fee and liquidity */
  async listPools(a: { tokenIn: string; tokenOut: string }) {
    const url = `${this.d.quoteApiUrl}/pools?tokenIn=${this.addr(a.tokenIn)}&tokenOut=${this.addr(a.tokenOut)}`;
    const body = await this.get<{ pools: { poolId: Hex; description?: string; key: ApiRoute["key"]; liquidity: string; status: string }[] }>(url);
    for (const p of body.pools) if (p.description) this.poolNames.set(p.poolId.toLowerCase(), p.description);
    return {
      pools: body.pools.map((p) => ({
        poolId: p.poolId,
        description: p.description,
        hook: p.key.hooks === ZERO ? null : p.key.hooks,
        feePips: p.key.fee,
        hookStatus: p.status,
        hasLiquidity: BigInt(p.liquidity) > 0n,
      })),
    };
  }

  /** the public honesty record of one hook */
  async getHookScore(a: { hook: string }) {
    const h = this.addr(a.hook);
    const s = await this.get<Record<string, unknown>>(`${this.d.quoteApiUrl}/hooks/${h}`);
    return s;
  }

  /** ordered routes, best quote first, with the floor FIRM would enforce */
  async quote(a: { tokenIn: string; tokenOut: string; amount: string }) {
    const { tokenIn, tokenOut, amountIn, r } = await this.route(a);
    const dIn = await this.dec(tokenIn);
    const dOut = await this.dec(tokenOut);
    return {
      amountIn: a.amount,
      routes: r.routes.map((x, i) => ({
        rank: i + 1,
        poolId: x.poolId,
        description: x.description,
        quotedOut: formatUnits(BigInt(x.quotedOut), dOut),
        floor: formatUnits(BigInt(x.floor), dOut),
        hookStatus: x.status,
        toleranceBps: x.toleranceBps,
      })),
      skipped: r.skipped.map((s) => ({ poolId: s.poolId, reason: s.reason })),
      note: `amountIn ${formatUnits(amountIn, dIn)}. Quotes are indicative: FirmRouter re-quotes every leg onchain and rejects a leg that delivers less than its quote.`,
    };
  }

  // ------------------------------------------------------------------ swaps
  /** protected swap through FirmRouter: tries routes best-first, rejects and strikes any that break their quote */
  async firmSwap(a: { tokenIn: string; tokenOut: string; amount: string; minOut?: string }) {
    const wallet = this.needWallet();
    const { tokenIn, tokenOut, amountIn, r } = await this.route(a);
    if (r.calldataRoutes.length === 0) throw new ToolError("no route available for this pair and amount");
    const dOut = await this.dec(tokenOut);
    const minTotalOut = a.minOut ? parseUnits(a.minOut, dOut) : 0n;
    const routes: RouteT[] = r.calldataRoutes.map((c) => ({ ...c, advertisedOut: BigInt(c.advertisedOut) }));
    const router = this.d.dep.core.firmRouter.address;

    await this.ensureAllowance(tokenIn, router, amountIn);
    const before = await this.balance(tokenOut);
    const hash = await wallet.writeContract({
      address: router,
      abi: FirmRouterAbi,
      functionName: "swapExactIn",
      args: [routes, amountIn, minTotalOut, wallet.account.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
      gas: this.d.gasFirmSwap ?? 4_000_000n,
    });
    const receipt = await waitForReceipt(this.d.client, hash);
    if (receipt.status !== "success") throw new ToolError(`transaction ${hash} reverted as a whole (nothing was spent except gas)`);

    const events = parseEventLogs({ abi: FirmRouterAbi, logs: receipt.logs });
    const filled = events.find((e) => e.eventName === "Filled");
    const rejected = events.filter((e) => e.eventName === "Rejected");
    const skipped = events.filter((e) => e.eventName === "LegSkipped");
    const received = (await this.balance(tokenOut)) - before;
    const fmt = (v: bigint) => formatUnits(v, dOut);
    return {
      txHash: hash,
      filled: !!filled,
      legIndex: filled ? Number((filled.args as { legIndex: number }).legIndex) : -1,
      received: fmt(received),
      quotedByFilledLeg: filled ? fmt((filled.args as { quotedOut: bigint }).quotedOut) : null,
      rejectedLegs: rejected.map((e) => {
        const x = e.args as { poolId: Hex; hook: Address; quotedOut: bigint; settledOut: bigint; execFailed: boolean };
        return {
          poolId: x.poolId,
          hook: x.hook,
          quoted: fmt(x.quotedOut),
          wouldHaveDelivered: x.execFailed ? "swap failed" : fmt(x.settledOut),
          shortfallBps: x.execFailed ? 10_000 : Number(shortfallBps(x.quotedOut, x.settledOut)),
        };
      }),
      skippedLegs: skipped.length,
      timeline: describeFirmLogs(receipt.logs, this.poolNames).map((s) => s.text),
      message: filled
        ? "Protected swap filled."
        : "No pool honoured its quote. Your tokens were returned; the offending hooks were struck.",
    };
  }

  /** UNPROTECTED comparator (RawRouter): executes one pool with no quote check. Benchmark use only. */
  async rawSwap(a: { poolId: string; amount: string; tokenIn: string; tokenOut: string }) {
    const wallet = this.needWallet();
    let entry = this.lastRoutes.get(a.poolId.toLowerCase());
    if (!entry) {
      await this.route(a); // refresh the cache
      entry = this.lastRoutes.get(a.poolId.toLowerCase());
    }
    if (!entry) throw new ToolError(`unknown poolId ${a.poolId} for this pair; call quote first`);
    const tokenIn = this.addr(a.tokenIn);
    const tokenOut = this.addr(a.tokenOut);
    const dOut = await this.dec(tokenOut);
    const amountIn = parseUnits(a.amount, await this.dec(tokenIn));
    const rawRouter = this.d.dep.core.rawRouter.address;

    await this.ensureAllowance(tokenIn, rawRouter, amountIn);
    const before = await this.balance(tokenOut);
    const hash = await wallet.writeContract({
      address: rawRouter,
      abi: RawRouterAbi,
      functionName: "swapExactInRaw",
      args: [{ ...entry.call, advertisedOut: 0n }, amountIn, 0n, wallet.account.address],
      gas: this.d.gasRawSwap ?? 2_000_000n,
    });
    const receipt = await waitForReceipt(this.d.client, hash);
    if (receipt.status !== "success") throw new ToolError(`raw swap ${hash} reverted`);
    const received = (await this.balance(tokenOut)) - before;
    const quoted = BigInt(entry.api.quotedOut);
    return {
      txHash: hash,
      pool: entry.api.description ?? a.poolId,
      quoted: formatUnits(quoted, dOut),
      received: formatUnits(received, dOut),
      shortfallBps: Number(shortfallBps(quoted, received)),
      warning: "UNPROTECTED comparator: no quote check, no fallback.",
    };
  }

  // ------------------------------------------------------------------ helpers
  private needWallet() {
    if (!this.d.wallet) throw new ToolError("this tool server has no wallet configured (set TRADER_PRIVATE_KEY)");
    return this.d.wallet;
  }

  private addr(a: string): Address {
    try {
      return getAddress(a.toLowerCase());
    } catch {
      throw new ToolError(`"${a}" is not a valid address`);
    }
  }

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res.ok) throw new ToolError(`quote-api ${res.status}: ${body?.error?.message ?? "request failed"}`);
    return body as T;
  }

  private async route(a: { tokenIn: string; tokenOut: string; amount: string }) {
    const tokenIn = this.addr(a.tokenIn);
    const tokenOut = this.addr(a.tokenOut);
    if (!/^\d+(\.\d+)?$/.test(a.amount)) throw new ToolError(`amount must be a positive decimal number, got "${a.amount}"`);
    const amountIn = parseUnits(a.amount, await this.dec(tokenIn));
    if (amountIn <= 0n) throw new ToolError("amount must be greater than zero");
    const res = await this.fetchFn(`${this.d.quoteApiUrl}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenIn, tokenOut, amountIn: amountIn.toString() }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as (ApiRouteResponse & { error?: { message?: string } }) | null;
    if (!res.ok || !body) throw new ToolError(`quote-api ${res.status}: ${body?.error?.message ?? "request failed"}`);

    this.lastRoutes = new Map();
    body.routes.forEach((x, i) => {
      const call = body.calldataRoutes[i];
      if (!call) return; // quote-api returns the two arrays in parallel; a missing entry means nothing executable
      this.lastRoutes.set(x.poolId.toLowerCase(), { api: x, call: { ...call, advertisedOut: BigInt(call.advertisedOut) } });
      if (x.description) this.poolNames.set(x.poolId.toLowerCase(), x.description);
    });
    return { tokenIn, tokenOut, amountIn, r: body };
  }

  private async dec(token: Address): Promise<number> {
    const k = token.toLowerCase();
    const hit = this.decimals.get(k);
    if (hit !== undefined) return hit;
    const d = await this.d.client.readContract({ address: token, abi: Erc20Abi, functionName: "decimals" });
    this.decimals.set(k, Number(d));
    return Number(d);
  }

  private async balance(token: Address): Promise<bigint> {
    return this.d.client.readContract({ address: token, abi: Erc20Abi, functionName: "balanceOf", args: [this.needWallet().account.address] });
  }

  /** approve exactly what is needed (not max): the router holds nothing between calls, but least privilege costs nothing */
  private async ensureAllowance(token: Address, spender: Address, amount: bigint) {
    const wallet = this.needWallet();
    const have = await this.d.client.readContract({ address: token, abi: Erc20Abi, functionName: "allowance", args: [wallet.account.address, spender] });
    if (have >= amount) return;
    const hash = await wallet.sendTransaction({
      to: token,
      data: encodeFunctionData({ abi: Erc20Abi, functionName: "approve", args: [spender, amount] }),
      gas: 100_000n,
    });
    await waitForReceipt(this.d.client, hash);
  }
}
