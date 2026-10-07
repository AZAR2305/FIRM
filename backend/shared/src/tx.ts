import type { Hex, PublicClient, TransactionReceipt } from "viem";

/**
 * Plain bounded poll for a receipt. viem's waitForTransactionReceipt watcher can stall against some RPCs (seen on an
 * anvil fork), and a stalled watcher must never hang an agent or a benchmark run.
 */
export async function waitForReceipt(
  client: PublicClient,
  hash: Hex,
  { timeoutMs = 90_000, pollMs = 250 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<TransactionReceipt> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (r) return r;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the receipt of ${hash}`);
    await new Promise((res) => setTimeout(res, pollMs));
  }
}
