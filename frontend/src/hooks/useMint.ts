"use client";

import { useState } from "react";
import { useAccount, useChainId, usePublicClient, useConnect, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { GAS, monadTestnet } from "@/lib/config";
import { deployments, tokens } from "@/lib/deployments";
import { describeError, waitForReceipt } from "@/lib/tx";

/** MockToken.MAX_PUBLIC_MINT (10,000 per call) */
const MINT_AMOUNT = parseUnits("10000", 18);

export type MintState =
  | { phase: "idle" }
  | { phase: "working"; step: string }
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

/** "Mint test tokens" (spec 12.1): MockToken.mint(me, 10,000) for tUSD and tUSDC, each simulated first, with an explicit gas limit. */
export function useMint() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const client = usePublicClient({ chainId: monadTestnet.id });
  const qc = useQueryClient();
  const [state, setState] = useState<MintState>({ phase: "idle" });

  async function mint() {
    if (!deployments || !client) return;
    try {
      let account = address;
      if (!isConnected) {
        setState({ phase: "working", step: "Connecting wallet" });
        const res = await connectAsync({ connector: connectors[0]!, chainId: monadTestnet.id });
        account = res.accounts[0];
      }
      if (chainId !== monadTestnet.id && isConnected) {
        setState({ phase: "working", step: "Switching to Monad Testnet" });
        await switchChainAsync({ chainId: monadTestnet.id });
      }
      if (!account) throw new Error("No account available. Connect a wallet first.");
      // fetched after connecting, so a click that also connected the wallet works in one go
      const w = await getWalletClient(wagmiConfig, { chainId: monadTestnet.id, account });
      if (!w) throw new Error("Wallet is not ready. Try again.");

      const t = tokens(deployments);
      for (const token of [t.tUSD, t.tUSDC]) {
        setState({ phase: "working", step: `Simulating mint of 10,000 ${token.symbol}` });
        const { request } = await client.simulateContract({
          address: token.address,
          abi: deployments.abis.MockToken,
          functionName: "mint",
          args: [account, MINT_AMOUNT],
          account,
        });
        setState({ phase: "working", step: `Confirm the ${token.symbol} mint in your wallet` });
        const hash = await w.writeContract({ ...request, gas: GAS.mint });
        setState({ phase: "working", step: `Waiting for the ${token.symbol} mint to confirm` });
        const receipt = await waitForReceipt(client, hash);
        if (receipt.status !== "success") throw new Error(`The ${token.symbol} mint reverted on-chain.`);
      }
      await qc.invalidateQueries({ queryKey: ["balances"] });
      setState({ phase: "done", message: "Minted 10,000 tUSD and 10,000 tUSDC to your wallet." });
    } catch (e) {
      setState({ phase: "error", message: describeError(e) });
    }
  }

  return { state, mint };
}
