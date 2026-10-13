import Link from "next/link";
import { EXPLORER_URL, FAUCET_URL, addressUrl } from "@/lib/config";
import { deployments } from "@/lib/deployments";

const REPO = "https://github.com/AZAR2305/FIRM";

/** Footer with the product map, the evidence documents, the chain links and the disclosures a reviewer looks for. */
export function SiteFooter() {
  const sb = deployments?.core.scoreboard.address;
  const col = "space-y-2 text-sm";
  const h = "mb-2 text-xs font-bold uppercase tracking-wide text-mute";
  return (
    <footer className="mt-24 border-t border-line bg-panel2" data-testid="site-footer">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className={col}>
          <p className={h}>Product</p>
          <p><Link href="/demo">Guided demo</Link></p>
          <p><Link href="/swap">Swap: raw vs protected</Link></p>
          <p><Link href="/leaderboard">Hook leaderboard</Link></p>
          <p><Link href="/proof">Proof</Link></p>
          <p><Link href="/integrate">Integrate</Link></p>
        </div>
        <div className={col}>
          <p className={h}>Evidence and docs</p>
          <p><a href={`${REPO}/blob/main/RESULTS.md`} target="_blank" rel="noreferrer">RESULTS.md: measured, fork vs testnet</a></p>
          <p><a href={`${REPO}/blob/main/THREAT_MODEL.md`} target="_blank" rel="noreferrer">THREAT_MODEL.md: the limits</a></p>
          <p><a href={`${REPO}/blob/main/DEPLOYMENTS.md`} target="_blank" rel="noreferrer">DEPLOYMENTS.md: every address</a></p>
          <p><a href={`${REPO}/blob/main/docs/SPIKES.md`} target="_blank" rel="noreferrer">Spikes and gas caps</a></p>
          <p><a href={REPO} target="_blank" rel="noreferrer">Source code (MIT)</a></p>
        </div>
        <div className={col}>
          <p className={h}>Monad Testnet (chain 10143)</p>
          <p><a href={EXPLORER_URL} target="_blank" rel="noreferrer">Block explorer</a></p>
          {sb ? <p><a href={addressUrl(sb)} target="_blank" rel="noreferrer">Scoreboard contract</a></p> : null}
          <p><a href={FAUCET_URL} target="_blank" rel="noreferrer">MON faucet</a></p>
          <p className="text-xs text-mute">Test tokens only. Nothing here has any value.</p>
        </div>
        <div className={col}>
          <p className={h}>Honest disclosures</p>
          <p className="text-xs text-mute">Built with AI coding tools (Claude Code).</p>
          <p className="text-xs text-mute">The cheating hooks are our own test fixtures. Catching them shows the mechanism works, not that real malicious hooks are caught.</p>
          <p className="text-xs text-mute">Uniswap v4 on Monad Testnet is a Monad-maintained deployment. FIRM is not affiliated with Uniswap Labs, the Monad Foundation or Envio.</p>
        </div>
      </div>
    </footer>
  );
}
