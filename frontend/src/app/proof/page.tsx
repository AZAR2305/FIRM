import Link from "next/link";
import { CostCard } from "@/components/CostCard";
import { NotDeployed } from "@/components/States";
import { AddressLink, ExplorerTxLink } from "@/components/TxLink";
import { deployments } from "@/lib/deployments";
import { evidence, evidenceMissingReason, num, type EvidenceEvent } from "@/lib/evidence";
import { fmt } from "@/lib/format";

export const metadata = { title: "Proof | FIRM" };

const STATUS = ["UNRATED", "NORMAL", "WATCH", "BLOCKED"];

function describe(e: EvidenceEvent): string {
  const q = e.quotedOut ? fmt(BigInt(e.quotedOut), 4) : "";
  const s = e.settledOut ? fmt(BigInt(e.settledOut), 4) : "";
  switch (e.name) {
    case "RawSwap":
      return `RawSwap Pool ${e.pool}: in ${fmt(BigInt(e.amountIn ?? 0), 0)}, out ${fmt(BigInt(e.amountOut ?? 0), 4)} (no check)`;
    case "Rejected":
      return `Rejected Pool ${e.pool}: quoted ${q}, delivered ${s}${e.execFailed ? " (swap failed)" : ""}`;
    case "StrikeRecorded":
      return `StrikeRecorded Pool ${e.pool}: shortfall ${e.shortfallBps} bps`;
    case "StatusChanged":
      return `StatusChanged: ${STATUS[Number(e.oldStatus)] ?? e.oldStatus} -> ${STATUS[Number(e.newStatus)] ?? e.newStatus} (${e.reason})`;
    case "Filled":
      return `Filled via Pool ${e.pool}: quoted ${q}, delivered ${s}`;
    case "FillRecorded":
      return `FillRecorded Pool ${e.pool}`;
    case "LegSkipped":
      return `LegSkipped Pool ${e.pool}: reason ${e.reason}`;
    case "NoFill":
      return "NoFill: input returned";
    default:
      return e.name;
  }
}

export default function ProofPage() {
  const d = deployments;
  if (!d) {
    return (
      <div className="space-y-12">
        <h1 className="page-title">Proof</h1>
        <NotDeployed />
      </div>
    );
  }
  const ev = evidence;
  const core = Object.entries(d.core);
  const fixtures = Object.entries(d.fixtures);
  return (
    <div className="space-y-10">
      <div className="page-head">
        <h1 className="page-title">Proof, with sources</h1>
        <p className="page-lead">
          Everything here can be checked by you: each item links to the block explorer, and the numbers come from reading the chain, not from us. Hooks and pools are our own
          test fixtures, so this proves the mechanism works, not that real third-party hooks are caught.
        </p>
        {d.source === "fork" ? <p className="mt-2 text-sm font-bold text-bad">This build points at a LOCAL FORK, not the public testnet.</p> : null}
      </div>

      <section className="space-y-3" aria-labelledby="txs">
        <h2 id="txs" className="text-lg font-bold">
          1. The two real transactions
        </h2>
        {ev && ev.txs.length > 0 ? (
          ev.txs.map((t) => (
            <div key={t.hash} className="card p-4" data-testid={`proof-tx-${t.label}`}>
              <p className="font-semibold">{t.title}</p>
              <p className="mt-1 text-sm">
                <ExplorerTxLink hash={t.hash} label={t.status === "success" ? "Confirmed:" : "Reverted:"} />{" "}
                <span className="text-xs text-mute">block {t.block.toLocaleString("en-US")}, {new Date(t.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC, gas limit {Number(t.gasLimit).toLocaleString("en-US")}</span>
              </p>
              <ol className="mt-2 space-y-1 text-sm text-mute">
                {t.events.map((e, i) => (
                  <li key={i} className="mono text-xs">{describe(e)}</li>
                ))}
              </ol>
            </div>
          ))
        ) : (
          <p className="break-words text-sm text-mute" data-testid="no-evidence">No evidence file for this build ({evidenceMissingReason}). Generate it with <span className="mono">node scripts/build-evidence.mjs --tx raw=0x... --tx firm=0x...</span>.</p>
        )}
        <p className="text-xs text-mute">The events above are decoded from the transaction receipts by <span className="mono">scripts/build-evidence.mjs</span>.</p>
      </section>

      <section className="space-y-3" aria-labelledby="contracts">
        <h2 id="contracts" className="text-lg font-bold">
          2. The deployed contracts (Monad Testnet, chain 10143)
        </h2>
        <div className="card table-wrap">
          <table className="t" data-testid="contracts-table">
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col">Address</th>
                <th scope="col">Source verification</th>
              </tr>
            </thead>
            <tbody>
              {[...core, ...fixtures].map(([k, e]) => (
                <tr key={k}>
                  <td>
                    {e.contract.split(":").pop()} <span className="text-xs text-mute">({k})</span>
                  </td>
                  <td><AddressLink address={e.address} label={e.address} /></td>
                  <td className={e.verification === "verified" ? "text-ok" : "text-warn"}>{e.verification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ev ? (
          <p className="text-xs text-mute" data-testid="deployment-record">
            Deployment ({String(ev.recorded.deployment.date)}): {String(ev.recorded.deployment.succeeded)} of {String(ev.recorded.deployment.transactions)} transactions succeeded, each with an explicit
            gas limit ({Number(ev.recorded.deployment.gasLimitsSent).toLocaleString("en-US")} in total); about {String(ev.recorded.deployment.monSpent)} MON ({String(ev.recorded.deployment.monSpentNote)}); {String(ev.recorded.deployment.verified)}. Every address and
            transaction hash is also in <span className="mono">DEPLOYMENTS.md</span>.
          </p>
        ) : null}
      </section>

      <CostCard />

      {ev ? (
        <section className="space-y-3" aria-labelledby="gas">
          <h2 id="gas" className="text-lg font-bold">
            3. Gas, measured on Monad (not on a fork)
          </h2>
          <p className="max-w-3xl text-sm text-mute">
            Monad charges the gas limit. The first swap through a hook creates storage and costs more than later swaps; both are shown. A hook the router has BLOCKED is skipped, so a
            protected estimate through it would not include a swap and is not reported.
          </p>
          <div className="card table-wrap">
            <table className="t" data-testid="gas-table">
              <thead>
                <tr>
                  <th scope="col">Pool</th>
                  <th scope="col" className="text-right">Raw, first touch</th>
                  <th scope="col" className="text-right">Protected, first touch</th>
                  <th scope="col" className="text-right">Raw, now</th>
                  <th scope="col" className="text-right">Protected, now</th>
                  <th scope="col">Status now</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ev.recorded.firstTouch.pools).map(([n, ft]) => {
                  const now = ev.gas.pools[n];
                  return (
                    <tr key={n}>
                      <td><strong>Pool {n}</strong></td>
                      <td className="mono text-right">{ft.raw.toLocaleString("en-US")}</td>
                      <td className="mono text-right">{ft.protected.toLocaleString("en-US")}</td>
                      <td className="mono text-right">{num(now?.raw)?.toLocaleString("en-US") ?? "-"}</td>
                      <td className="mono text-right">{num(now?.protected)?.toLocaleString("en-US") ?? <span className="text-xs text-mute" title={now?.protectedNote}>skipped</span>}</td>
                      <td className="text-xs text-mute">{now?.status ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-mute">
            <li>
              Demo shape (1,000 tUSD, routes B then C then A, B rejected): <span className="mono text-ink">{ev.recorded.firstTouch.demoShape.toLocaleString("en-US")}</span> gas, measured before the demo swap.
            </li>
            <li>
              One in-transaction quote costs at most <span className="mono text-ink">{Math.max(...Object.values(ev.recorded.firstTouch.quotePerCall)).toLocaleString("en-US")}</span> gas against the router&apos;s 300,000 cap.
            </li>
            <li>A first version of our demo script used fork numbers and its raw swap ran out of gas on the real chain: Monad costs about 1.5x to 1.6x what a fork says.</li>
            <li>Method: {ev.gas.method}.</li>
          </ul>
        </section>
      ) : null}

      {ev ? (
        <section className="space-y-3" aria-labelledby="envio">
          <h2 id="envio" className="text-lg font-bold">
            4. The indexer agrees with the chain
          </h2>
          <p className="text-sm text-mute" data-testid="envio-check">
            {ev.recorded.envioCheck.date}, <span className="mono">{ev.recorded.envioCheck.command}</span>: {ev.recorded.envioCheck.result} ({ev.recorded.envioCheck.mode}). See the live version on the{" "}
            <Link href="/leaderboard">leaderboard</Link>, which shows which source answered.
          </p>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="notrun">
        <h2 id="notrun" className="text-lg font-bold">
          5. What we did not run, and what we do not claim
        </h2>
        <ul className="card max-w-3xl list-disc space-y-1 p-5 pl-9 text-sm text-mute" data-testid="not-run">
          {ev ? <li>{ev.recorded.notRun}</li> : null}
          <li>We have not measured how many real third-party hooks cheat. The 54.2% and 26.4% figures are 0x&apos;s classification, disputed by Uniswap&apos;s founder.</li>
          <li>The cheating hooks here are our own fixtures. Catching them shows the mechanism works.</li>
          <li>A hook that is honest to the router and cheats others is not caught by the router (0 of 20 in our fork benchmark); only the canary can.</li>
          <li>One owner key controls the Scoreboard. It cannot move user funds. See THREAT_MODEL.md.</li>
        </ul>
        <p className="text-xs text-mute">Reproduce: <span className="mono">node scripts/build-evidence.mjs</span>, <span className="mono">cd backend/bench &amp;&amp; pnpm check-indexer</span>, and RESULTS.md in the repository.</p>
      </section>
    </div>
  );
}
