"use client";

import { useState } from "react";
import { useAccount, useChainId, usePublicClient, useConnect, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseUnits, type Hex } from "viem";
import { GAS, monadTestnet } from "@/lib/config";
import { deployments, tokens } from "@/lib/deployments";
import { describeError, waitForReceipt } from "@/lib/tx";

/** MockToken.MAX_PUBLIC_MINT (10,000 per call) */
const MINT_AMOUNT = parseUnits("10000", 18);

/** a confirmed mint, for the explorer link */
export interface MintTx {
  symbol: string;
  hash: Hex;
}

/** `txs` always lists the mints that already confirmed, so their explorer links stay visible even if a later step fails. */
export type MintState =
  | { phase: "idle"; txs: MintTx[] }
  | { phase: "working"; step: string; txs: MintTx[] }
  | { phase: "done"; message: string; txs: MintTx[] }
  | { phase: "error"; message: string; txs: MintTx[] };

/** "Mint test tokens" (spec 12.1): MockToken.mint(me, 10,000) for tUSD and tUSDC, each simulated first, with an explicit gas limit. */
export function useMint() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const client = usePublicClient({ chainId: monadTestnet.id });
  const qc = useQueryClient();
  const [state, setState] = useState<MintState>({ phase: "idle", txs: [] });

  async function mint() {
    if (!deployments || !client) return;
    const txs: MintTx[] = [];
    try {
      let account = address;
      if (!isConnected) {
        setState({ phase: "working", step: "Connecting wallet", txs });
        const res = await connectAsync({ connector: connectors[0]!, chainId: monadTestnet.id });
        account = res.accounts[0];
      }
      if (chainId !== monadTestnet.id && isConnected) {
        setState({ phase: "working", step: "Switching to Monad Testnet", txs });
        await switchChainAsync({ chainId: monadTestnet.id });
      }
      if (!account) throw new Error("No account available. Connect a wallet first.");
      // fetched after connecting, so a click that also connected the wallet works in one go
      const w = await getWalletClient(wagmiConfig, { chainId: monadTestnet.id, account });
      if (!w) throw new Error("Wallet is not ready. Try again.");

      const t = tokens(deployments);
      for (const token of [t.tUSD, t.tUSDC]) {
        setState({ phase: "working", step: `Simulating mint of 10,000 ${token.symbol}`, txs: txs.slice() });
        const { request } = await client.simulateContract({
          address: token.address,
          abi: deployments.abis.MockToken,
          functionName: "mint",
          args: [account, MINT_AMOUNT],
          account,
        });
        setState({ phase: "working", step: `Confirm the ${token.symbol} mint in your wallet`, txs: txs.slice() });
        const hash = await w.writeContract({ ...request, gas: GAS.mint });
        setState({ phase: "working", step: `Waiting for the ${token.symbol} mint to confirm`, txs: txs.slice() });
        const receipt = await waitForReceipt(client, hash);
        if (receipt.status !== "success") throw new Error(`The ${token.symbol} mint reverted on-chain.`);
        txs.push({ symbol: token.symbol, hash });
      }
      await qc.invalidateQueries({ queryKey: ["balances"] });
      setState({ phase: "done", message: "Minted 10,000 tUSD and 10,000 tUSDC to your wallet.", txs: txs.slice() });
    } catch (e) {
      setState({ phase: "error", message: describeError(e), txs: txs.slice() });
    }
  }

  return { state, mint };
}
