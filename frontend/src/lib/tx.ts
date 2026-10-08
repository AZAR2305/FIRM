import type { PublicClient, TransactionReceipt, Hex } from "viem";
import { GAS } from "./config";

/** Polls for a receipt. (viem's waitForTransactionReceipt can stall against automining dev nodes; polling works everywhere.) */
export async function waitForReceipt(client: PublicClient, hash: Hex, timeoutMs = 120_000, everyMs = 700): Promise<TransactionReceipt> {
  const start = Date.now();
  for (;;) {
    try {
      const r = await client.getTransactionReceipt({ hash });
      if (r) return r;
    } catch {
      // not mined yet (viem throws TransactionReceiptNotFoundError)
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for transaction ${hash}. It may still confirm: check the explorer.`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Monad charges the gas LIMIT, so the limit sent is the estimate plus a small buffer, not a generous constant. */
export function bufferedGas(estimate: bigint): bigint {
  return (estimate * (100n + GAS.estimateBufferPct)) / 100n;
}

/** A readable one-liner for the errors a wallet or RPC throws. */
export function describeError(e: unknown): string {
  const err = e as { name?: string; shortMessage?: string; message?: string; cause?: { name?: string; shortMessage?: string; reason?: string } };
  const names = [err?.name, err?.cause?.name].join(" ");
  if (/UserRejected/i.test(names) || /user rejected|user denied|rejected the request/i.test(err?.message ?? "")) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }
  const reason = err?.cause?.reason ?? err?.cause?.shortMessage ?? err?.shortMessage ?? err?.message ?? "Unknown error";
  return reason.split("\n")[0]!.slice(0, 300);
}
