import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import {
  IV4QuoterAbi,
  Multicall3Abi,
  StateViewAbi,
  ScoreboardAbi,
  FirmRouterAbi,
  RawRouterAbi,
  readStatuses,
  readTolerances,
  MULTICALL3,
  type Deployments,
  type PoolKeyT,
  type RouteT,
  type StatusName,
} from "@firm/shared";

export interface QuoteRequest {
  key: PoolKeyT;
  zeroForOne: boolean;
  amountIn: bigint;
  hookData: Hex;
}

export interface SwapPreview {
  naiveOut: bigint | null;
  firmOut: bigint | null;
  firmLegIndex: number | null;
  note?: string;
}

/** Everything quote-api needs from the chain. An interface so the route algorithm is testable with a mock. */
export interface ChainReader {
  blockNumber(): Promise<bigint>;
  statuses(hooks: Address[]): Promise<Map<string, StatusName>>;
  tolerances(hooks: Address[]): Promise<Map<string, number>>;
  unratedCap(): Promise<bigint>;
  liquidity(poolIds: Hex[]): Promise<Map<string, bigint>>;
  /** One quote per request through Multicall3; `null` where the Quoter reverted. */
  quotes(reqs: QuoteRequest[]): Promise<(bigint | null)[]>;
  /** eth_call preview of the naive pick vs FirmRouter for a wallet. Never throws. */
  preview(wallet: Address, routes: RouteT[], tokenIn: Address, amountIn: bigint): Promise<SwapPreview>;
  rpcInUse(): string | undefined;
}

const QUOTE_BATCH = 10;

export class ViemChainReader implements ChainReader {
  constructor(
    private readonly client: PublicClient,
    private readonly dep: Deployments,
    private readonly inUse: () => string | undefined = () => undefined,
  ) {}

  rpcInUse() {
    return this.inUse();
  }

  blockNumber() {
    return this.client.getBlockNumber();
  }

  statuses(hooks: Address[]) {
    return readStatuses(this.client, this.dep.core.scoreboard.address, hooks);
  }

  tolerances(hooks: Address[]) {
    return readTolerances(this.client, this.dep.core.scoreboard.address, hooks);
  }

  async unratedCap() {
    return this.client.readContract({
      address: this.dep.core.scoreboard.address,
      abi: ScoreboardAbi,
      functionName: "unratedCap",
    }) as Promise<bigint>;
  }

  async liquidity(poolIds: Hex[]) {
    const out = new Map<string, bigint>();
    if (poolIds.length === 0) return out;
    const res = await this.client.multicall({
      allowFailure: true,
      contracts: poolIds.map(
        (id) => ({ address: this.dep.infra.stateView, abi: StateViewAbi, functionName: "getLiquidity", args: [id] }) as const,
      ),
    });
    poolIds.forEach((id, i) => {
      const r = res[i];
      out.set(id.toLowerCase(), r && r.status === "success" ? (r.result as bigint) : 0n);
    });
    return out;
  }

  async quotes(reqs: QuoteRequest[]): Promise<(bigint | null)[]> {
    const out: (bigint | null)[] = new Array(reqs.length).fill(null);
    for (let start = 0; start < reqs.length; start += QUOTE_BATCH) {
      const slice = reqs.slice(start, start + QUOTE_BATCH);
      const calls = slice.map((r) => ({
        target: this.dep.infra.v4Quoter,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: IV4QuoterAbi,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey: r.key, zeroForOne: r.zeroForOne, exactAmount: r.amountIn, hookData: r.hookData }],
        }),
      }));
      // The Quoter is not a view function, so call Multicall3.aggregate3 with eth_call (no transaction is sent).
      const { data } = await this.client.call({
        to: MULTICALL3,
        data: encodeFunctionData({ abi: Multicall3Abi, functionName: "aggregate3", args: [calls] }),
      });
      if (!data) continue;
      const results = decodeFunctionResult({ abi: Multicall3Abi, functionName: "aggregate3", data });
      results.forEach((res, i) => {
        if (!res.success) return;
        try {
          const [amountOut] = decodeFunctionResult({
            abi: IV4QuoterAbi,
            functionName: "quoteExactInputSingle",
            data: res.returnData,
          }) as readonly [bigint, bigint];
          if (amountOut > 0n) out[start + i] = amountOut;
        } catch {
          /* malformed return data => treated as a failed quote */
        }
      });
    }
    return out;
  }

  async preview(wallet: Address, routes: RouteT[], tokenIn: Address, amountIn: bigint): Promise<SwapPreview> {
    const first = routes[0];
    if (!first) return { naiveOut: null, firmOut: null, firmLegIndex: null, note: "no routes" };
    try {
      const [balance, allowFirm, allowRaw] = await Promise.all([
        this.client.readContract({ address: tokenIn, abi: erc20, functionName: "balanceOf", args: [wallet] }),
        this.client.readContract({ address: tokenIn, abi: erc20, functionName: "allowance", args: [wallet, this.dep.core.firmRouter.address] }),
        this.client.readContract({ address: tokenIn, abi: erc20, functionName: "allowance", args: [wallet, this.dep.core.rawRouter.address] }),
      ]);
      if (balance < amountIn) return { naiveOut: null, firmOut: null, firmLegIndex: null, note: "wallet balance below amountIn" };
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      let firmOut: bigint | null = null;
      let leg: number | null = null;
      let naiveOut: bigint | null = null;
      const notes: string[] = [];

      if (allowFirm >= amountIn) {
        try {
          const sim = await this.client.simulateContract({
            account: wallet,
            address: this.dep.core.firmRouter.address,
            abi: FirmRouterAbi,
            functionName: "swapExactIn",
            args: [routes as never, amountIn, 0n, wallet, deadline],
          });
          firmOut = sim.result[0];
          leg = Number(sim.result[1]);
        } catch (e) {
          notes.push(`FirmRouter simulation failed: ${(e as Error).message.split("\n")[0]}`);
        }
      } else notes.push("approve FirmRouter to preview the protected swap");

      if (allowRaw >= amountIn) {
        try {
          const sim = await this.client.simulateContract({
            account: wallet,
            address: this.dep.core.rawRouter.address,
            abi: RawRouterAbi,
            functionName: "swapExactInRaw",
            args: [first as never, amountIn, 0n, wallet],
          });
          naiveOut = sim.result;
        } catch (e) {
          notes.push(`RawRouter simulation failed: ${(e as Error).message.split("\n")[0]}`);
        }
      } else notes.push("approve RawRouter to preview the unprotected swap");

      return { naiveOut, firmOut, firmLegIndex: leg, note: notes.join("; ") || undefined };
    } catch (e) {
      return { naiveOut: null, firmOut: null, firmLegIndex: null, note: `preview unavailable: ${(e as Error).message.split("\n")[0]}` };
    }
  }
}

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
