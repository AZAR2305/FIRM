import {
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { CanaryRunnerAbi, Erc20Abi, MockTokenAbi, shortfallBps, type Deployments, type Logger, type RouteT } from "@firm/shared";

export interface ProbeResult {
  txHash: Hex;
  blockNumber: bigint;
  probeSender: Address;
  quotedOut: bigint;
  settledOut: bigint;
  shortfallBps: bigint;
}

/** Sends one canary probe. An interface so the agent logic is testable without a chain. */
export interface ProbeExecutor {
  /** Make sure the agent wallet holds `amount` of each token and has approved CanaryRunner. */
  ensureFunding(tokens: Address[], amount: bigint): Promise<void>;
  probe(route: RouteT, amountIn: bigint, senderIdx: number): Promise<ProbeResult>;
}

/**
 * Real executor: calls CanaryRunner.probe from the agent's testnet wallet. The agent is only a trigger: the quote,
 * the swap and the Scoreboard write all happen onchain inside that one transaction.
 *
 * Monad charges the gas LIMIT, so the limit is explicit (CanaryRunner needs about 2 x its caps of headroom).
 */
export class ChainProbeExecutor implements ProbeExecutor {
  constructor(
    private readonly client: PublicClient,
    private readonly wallet: WalletClient<Transport, Chain, Account>,
    private readonly dep: Deployments,
    private readonly log: Logger,
    private readonly gasLimit = 2_000_000n,
  ) {}

  get account() {
    return this.wallet.account;
  }

  async ensureFunding(tokens: Address[], amount: bigint) {
    const me = this.wallet.account.address;
    const runner = this.dep.core.canaryRunner.address;
    const mintable = new Set(
      [this.dep.fixtures?.tUSD.address, this.dep.fixtures?.tUSDC.address].filter(Boolean).map((a) => a!.toLowerCase()),
    );
    for (const token of tokens) {
      const bal = await this.client.readContract({ address: token, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
      if (bal < amount) {
        // only our own quarantined MockTokens can be minted; real tokens must be funded by the operator
        if (!mintable.has(token.toLowerCase())) throw new Error(`agent wallet ${me} needs ${amount} of ${token}`);
        this.log.info("minting test tokens", { token });
        const hash = await this.wallet.writeContract({
          address: token,
          abi: MockTokenAbi,
          functionName: "mint",
          args: [me, 10_000n * 10n ** 18n],
          gas: 150_000n,
        });
        await this.client.waitForTransactionReceipt({ hash });
      }
      const allowance = await this.client.readContract({ address: token, abi: Erc20Abi, functionName: "allowance", args: [me, runner] });
      if (allowance < amount) {
        const hash = await this.wallet.writeContract({
          address: token,
          abi: Erc20Abi,
          functionName: "approve",
          args: [runner, 2n ** 256n - 1n],
          gas: 100_000n,
        });
        await this.client.waitForTransactionReceipt({ hash });
      }
    }
  }

  async probe(route: RouteT, amountIn: bigint, senderIdx: number): Promise<ProbeResult> {
    const hash = await this.wallet.writeContract({
      address: this.dep.core.canaryRunner.address,
      abi: CanaryRunnerAbi,
      functionName: "probe",
      args: [route as never, amountIn, senderIdx],
      gas: this.gasLimit,
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`probe tx ${hash} reverted`);
    const [done] = parseEventLogs({ abi: CanaryRunnerAbi, logs: receipt.logs, eventName: "ProbeDone" });
    if (!done) throw new Error(`probe tx ${hash} emitted no ProbeDone`);
    const { quotedOut, settledOut, probeSender } = done.args;
    return {
      txHash: hash,
      blockNumber: receipt.blockNumber,
      probeSender,
      quotedOut,
      settledOut,
      shortfallBps: shortfallBps(quotedOut, settledOut),
    };
  }
}
