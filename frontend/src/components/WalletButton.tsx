"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { monadTestnet } from "@/lib/config";
import { shortAddress } from "@/lib/format";

/** Connect / switch network / account. Handles "no wallet installed" and "wrong network" explicitly. */
export function WalletButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  // decided after mount: reading window.ethereum during render would make the first client render differ from the server HTML
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  useEffect(() => setHasWallet("ethereum" in window), []);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={isPending || hasWallet === false}
          title={hasWallet === false ? "No browser wallet found. Install MetaMask or a similar wallet." : undefined}
          onClick={() => connect({ connector: connectors[0]!, chainId: monadTestnet.id })}
        >
          {isPending ? "Connecting..." : hasWallet === false ? "No wallet detected" : "Connect wallet"}
        </button>
        {error ? <span className="max-w-64 text-right text-xs text-bad">{error.message.split("\n")[0]}</span> : null}
      </div>
    );
  }

  if (chainId !== monadTestnet.id) {
    return (
      <button type="button" className="btn btn-primary" disabled={switching} onClick={() => switchChain({ chainId: monadTestnet.id })}>
        {switching ? "Switching..." : "Switch to Monad Testnet"}
      </button>
    );
  }

  return (
    <button type="button" className="btn" onClick={() => disconnect()} title="Disconnect" aria-label={`Connected as ${address}. Disconnect`}>
      <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
      <span className="mono">{shortAddress(address!)}</span>
    </button>
  );
}
