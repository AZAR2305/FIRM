"use client";

import { FAUCET_URL } from "@/lib/config";
import { deployments } from "@/lib/deployments";
import { useMint } from "@/hooks/useMint";
import { ExplorerTxLink } from "./TxLink";

/** Persistent banner (spec 12.1) with the faucet link and the Mint test tokens button (MockToken.mint). */
export function TestnetBanner() {
  const { state, mint } = useMint();
  const working = state.phase === "working";
  return (
    <div className="border-b border-warn/40 bg-warn/10" data-testid="testnet-banner">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-1.5 text-xs sm:px-6">
        <strong className="text-warn">Monad Testnet. Test tokens only.</strong>
        <a href={FAUCET_URL} target="_blank" rel="noreferrer">
          MON faucet
        </a>
        <button type="button" className="btn btn-sm" onClick={mint} disabled={working || !deployments} data-testid="mint-button">
          {working ? "Minting..." : "Mint test tokens"}
        </button>
        <span role="status" aria-live="polite" className="text-mute" data-testid="mint-status">
          {state.phase === "working" ? state.step : null}
          {state.phase === "done" ? <span className="text-ok">{state.message}</span> : null}
          {state.phase === "error" ? <span className="text-bad">{state.message}</span> : null}
          {state.phase === "idle" && !deployments ? "Minting is available once FIRM is deployed." : null}
        </span>
        {state.txs.length > 0 ? (
          <span className="flex flex-wrap gap-x-4 text-xs text-mute" data-testid="mint-links">
            {state.txs.map((t) => (
              <ExplorerTxLink key={t.hash} hash={t.hash} label={`${t.symbol} mint`} />
            ))}
          </span>
        ) : null}
        {deployments?.source === "fork" ? (
          <strong className="ml-auto rounded border border-bad px-2 py-0.5 text-xs text-bad" title="This build reads a local fork deployment">
            LOCAL FORK BUILD: addresses are not on the public testnet
          </strong>
        ) : null}
      </div>
    </div>
  );
}
