import {
  createWalletClient,
  http,
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CanaryRunnerAbi,
  Erc20Abi,
  FirmRouterAbi,
  IV4QuoterAbi,
  MockTokenAbi,
  RawRouterAbi,
  ScoreboardAbi,
  createLogger,
  createRpcPool,
  endpointsFromEnv,
  monadTestnet,
  readHookStats,
  type Deployments,
  type HookStatsT,
  type PoolKeyT,
  type RouteT,
  type StatusName,
  STATUS_NAMES,
} from "@firm/shared";

const log = createLogger("bench-ctx");
export const E18 = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export interface FirmEvents {
  filled?: { poolId: Hex; hook: Address; amountIn: bigint; quotedOut: bigint; settledOut: bigint; legIndex: number };
  rejected: { poolId: Hex; hook: Address; quotedOut: bigint; settledOut: bigint; execFailed: boolean }[];
  skipped: { poolId: Hex; hook: Address; reason: number }[];
  noFill: boolean;
}

export interface SentTx {
  hash: Hex;
  receipt: TransactionReceipt;
  gasLimit: bigint;
}

/**
 * Everything an experiment needs: clients, the deployment, and thin helpers around the contracts. The bench wallet
 * is the deployer, which owns the Scoreboard (it needs `reinstate` to reset a hook between trials) and the
 * MockTokens (it needs `ownerMint`).
 */
export class Ctx {
  readonly rpc = createRpcPool();
  readonly client: PublicClient = this.rpc.client;
  readonly wallet: WalletClient<Transport, Chain, Account>;
  readonly me: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly zeroForOne: boolean;
  txCount = 0;

  constructor(
    readonly dep: Deployments,
    privateKey: Hex,
  ) {
    const account = privateKeyToAccount(privateKey);
    this.me = account.address;
    this.wallet = createWalletClient({ account, chain: monadTestnet, transport: http(endpointsFromEnv()[0]!.url) });
    if (!dep.pools || !dep.fixtures) throw new Error("deployment has no seeded pools: run SeedPools first");
    this.tokenIn = dep.fixtures.tUSD.address;
    this.tokenOut = dep.fixtures.tUSDC.address;
    this.zeroForOne = dep.pools.zeroForOne;
  }

  // ---------------------------------------------------------------- pools
  poolKey(name: string): PoolKeyT {
    const p = this.dep.pools!;
    const e = p.list[name];
    if (!e) throw new Error(`unknown pool ${name}`);
    return { currency0: p.currency0, currency1: p.currency1, fee: e.fee, tickSpacing: p.tickSpacing, hooks: e.hook };
  }

  route(name: string, advertisedOut = 0n): RouteT {
    return { key: this.poolKey(name), zeroForOne: this.zeroForOne, hookData: "0x", advertisedOut };
  }

  hook(name: string): Address {
    return this.dep.pools!.list[name]!.hook;
  }

  // ---------------------------------------------------------------- reads
  /** The in-transaction-comparable quote (Quoter via eth_call). */
  async quote(poolName: string, amountIn: bigint): Promise<bigint> {
    const key = this.poolKey(poolName);
    const { result } = await this.client.simulateContract({
      address: this.dep.infra.v4Quoter,
      abi: IV4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: key, zeroForOne: this.zeroForOne, exactAmount: amountIn, hookData: "0x" }],
      account: this.me,
    });
    return result[0];
  }

  async balance(token: Address, who: Address = this.me): Promise<bigint> {
    return this.client.readContract({ address: token, abi: Erc20Abi, functionName: "balanceOf", args: [who] });
  }

  async status(hook: Address): Promise<StatusName> {
    if (hook === ZERO) return "NORMAL";
    const s = await this.client.readContract({
      address: this.dep.core.scoreboard.address,
      abi: ScoreboardAbi,
      functionName: "statusOf",
      args: [hook],
    });
    return STATUS_NAMES[Number(s)]!;
  }

  stats(hook: Address): Promise<HookStatsT> {
    return readHookStats(this.client, this.dep.core.scoreboard.address, hook);
  }

  // ---------------------------------------------------------------- writes
  async send(p: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[]; gas: bigint }): Promise<SentTx> {
    const t0 = Date.now();
    const hash = await this.wallet.writeContract({ ...(p as object), gas: p.gas } as never);
    const receipt = await this.waitReceipt(hash);
    this.txCount++;
    log.debug("tx", { fn: p.functionName, ms: Date.now() - t0, status: receipt.status, gasUsed: receipt.gasUsed });
    return { hash, receipt, gasLimit: p.gas };
  }

  /** Plain bounded poll for the receipt (a stalled watcher can never hang a whole benchmark run). */
  private async waitReceipt(hash: Hex, timeoutMs = 90_000): Promise<TransactionReceipt> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const r = await this.client.getTransactionReceipt({ hash }).catch(() => null);
      if (r) return r;
      if (Date.now() > deadline) throw new Error(`timed out waiting for receipt of ${hash}`);
      await new Promise((res) => setTimeout(res, 250));
    }
  }

  /** Make sure the bench wallet holds `amount` of both tokens and has approved all routers. */
  async fund(amount: bigint) {
    for (const token of [this.tokenIn, this.tokenOut]) {
      if ((await this.balance(token)) < amount) {
        await this.send({ address: token, abi: MockTokenAbi, functionName: "ownerMint", args: [this.me, amount * 2n], gas: 150_000n });
      }
      for (const spender of [this.dep.core.firmRouter.address, this.dep.core.rawRouter.address, this.dep.core.canaryRunner.address]) {
        const a = await this.client.readContract({ address: token, abi: Erc20Abi, functionName: "allowance", args: [this.me, spender] });
        if (a < 2n ** 200n) {
          await this.send({ address: token, abi: Erc20Abi, functionName: "approve", args: [spender, 2n ** 256n - 1n], gas: 100_000n });
        }
      }
    }
  }

  /** BLOCKED -> WATCH (owner only) so the next deviation can be struck again. No-op if not BLOCKED. */
  async reinstateIfBlocked(hook: Address): Promise<boolean> {
    if (hook === ZERO) return false;
    if ((await this.status(hook)) !== "BLOCKED") return false;
    await this.send({ address: this.dep.core.scoreboard.address, abi: ScoreboardAbi, functionName: "reinstate", args: [hook], gas: 200_000n });
    return true;
  }

  async rawSwap(poolName: string, amountIn: bigint): Promise<{ out: bigint; tx: SentTx }> {
    const before = await this.balance(this.tokenOut);
    const tx = await this.send({
      address: this.dep.core.rawRouter.address,
      abi: RawRouterAbi,
      functionName: "swapExactInRaw",
      args: [this.route(poolName), amountIn, 0n, this.me],
      gas: 2_000_000n,
    });
    if (tx.receipt.status !== "success") throw new Error(`raw swap reverted ${tx.hash}`);
    return { out: (await this.balance(this.tokenOut)) - before, tx };
  }

  async firmSwap(routes: RouteT[], amountIn: bigint, minTotalOut = 0n): Promise<{ out: bigint; spent: bigint; leg: number; tx: SentTx; events: FirmEvents }> {
    const [inBefore, outBefore] = [await this.balance(this.tokenIn), await this.balance(this.tokenOut)];
    const tx = await this.send({
      address: this.dep.core.firmRouter.address,
      abi: FirmRouterAbi,
      functionName: "swapExactIn",
      args: [routes, amountIn, minTotalOut, this.me, BigInt(Math.floor(Date.now() / 1000) + 3600)],
      gas: 3_500_000n,
    });
    if (tx.receipt.status !== "success") throw new Error(`FirmRouter.swapExactIn reverted as a whole: ${tx.hash}`);
    const [inAfter, outAfter] = [await this.balance(this.tokenIn), await this.balance(this.tokenOut)];
    const events = this.parseFirm(tx.receipt);
    return { out: outAfter - outBefore, spent: inBefore - inAfter, leg: events.filled ? events.filled.legIndex : -1, tx, events };
  }

  parseFirm(receipt: TransactionReceipt): FirmEvents {
    const logs = parseEventLogs({ abi: FirmRouterAbi, logs: receipt.logs });
    const ev: FirmEvents = { rejected: [], skipped: [], noFill: false };
    for (const l of logs) {
      if (l.eventName === "Filled") {
        const a = l.args;
        ev.filled = { poolId: a.poolId, hook: a.hook, amountIn: a.amountIn, quotedOut: a.quotedOut, settledOut: a.settledOut, legIndex: a.legIndex };
      } else if (l.eventName === "Rejected") {
        const a = l.args;
        ev.rejected.push({ poolId: a.poolId, hook: a.hook, quotedOut: a.quotedOut, settledOut: a.settledOut, execFailed: a.execFailed });
      } else if (l.eventName === "LegSkipped") {
        ev.skipped.push({ poolId: l.args.poolId, hook: l.args.hook, reason: l.args.reason });
      } else if (l.eventName === "NoFill") ev.noFill = true;
    }
    return ev;
  }

  async probe(poolName: string, amountIn: bigint, senderIdx: number, zeroForOne = this.zeroForOne) {
    const route = { ...this.route(poolName), zeroForOne };
    const tx = await this.send({
      address: this.dep.core.canaryRunner.address,
      abi: CanaryRunnerAbi,
      functionName: "probe",
      args: [route, amountIn, senderIdx],
      gas: 2_000_000n,
    });
    if (tx.receipt.status !== "success") throw new Error(`probe reverted ${tx.hash}`);
    const [done] = parseEventLogs({ abi: CanaryRunnerAbi, logs: tx.receipt.logs, eventName: "ProbeDone" });
    return { tx, quotedOut: done!.args.quotedOut, settledOut: done!.args.settledOut };
  }

  get isLocalFork(): boolean {
    return this.rpc.endpoints.some((e) => e.url.includes("127.0.0.1") || e.url.includes("localhost"));
  }
}
