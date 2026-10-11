import Link from "next/link";
import { CostCard } from "@/components/CostCard";
import { LieDiagram } from "@/components/LieDiagram";
import { ExplorerTxLink } from "@/components/TxLink";
import { deployments } from "@/lib/deployments";
import { evidence, headline } from "@/lib/evidence";
import { fmt, pct } from "@/lib/format";

const AUDIENCES = [
  {
    who: "Traders and AI trading agents",
    pain: "They accept a quote and receive less. The difference is silent, and an agent that always takes the best quote is the easiest target.",
    gain: "A swap that either delivers what its pool quoted or falls back to another pool, in the same transaction. Their funds are never at risk from a failed leg.",
  },
  {
    who: "Routers, aggregators and wallets",
    pain: "They rank pools by a quote they cannot verify, then own the support burden when users get less than shown.",
    gain: "A public, on-chain Scoreboard any router can read (statusOf, toleranceBps) before it routes, or FirmRouter as the execution layer. No permission, no API key.",
  },
  {
    who: "Honest hook builders and liquidity providers",
    pain: "Honest hooks are lumped with the 54% 0x flags as malicious, and honest pools lose flow to cheats that quote better.",
    gain: "A public track record that is earned from real fills and canary probes, with a path back from a wrongly struck status.",
  },
];

export default function Landing() {
  const h = headline(evidence);
  const dep = deployments;
  return (
    <div className="space-y-14">
      <section className="space-y-5" aria-labelledby="pitch">
        <h1 id="pitch" className="max-w-4xl text-3xl font-extrabold leading-tight sm:text-4xl">
          A quote is a promise. FIRM checks that the pool kept it, inside the same transaction, strikes the hooks that break it in public, and falls back to an
          honest pool.
        </h1>
        <p className="max-w-3xl text-mute">
          FIRM is a Uniswap v4 router and an on-chain scoreboard for Monad. It is built for the one thing a router cannot see today: a hook that quotes one price and
          delivers another.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/demo" className="btn btn-primary no-underline" data-testid="try-demo">
            Try the demo
          </Link>
          <Link href="/proof" className="btn no-underline">
            See the proof on Monad Testnet
          </Link>
          <Link href="/leaderboard" className="btn no-underline">
            Hook leaderboard
          </Link>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="problem">
        <h2 id="problem" className="text-xl font-bold">
          The problem, and exactly where it happens
        </h2>
        <LieDiagram />
        <blockquote className="card max-w-3xl border-l-4 border-l-brand p-5">
          <p>
            0x analysed 84,163 Uniswap v4 hooks across 6 chains and classified <strong>54.2% as malicious</strong> and a further{" "}
            <strong>26.4% as &ldquo;likely malicious&rdquo;</strong> (19.4% safe), with data as of 11 September 2026.
          </p>
          <footer className="mt-3 text-xs text-mute">
            Source:{" "}
            <a href="https://0x.org/post/uniswap-v4-hooks-were-a-mistake" target="_blank" rel="noreferrer">
              0x, &ldquo;Uniswap v4 hooks were a mistake&rdquo;
            </a>
            , 14 September 2026. This is 0x&apos;s classification, not ours. Uniswap&apos;s founder disputes the framing, noting that the count includes hooks with little
            activity (via Crypto Briefing). 0x also describes hooks that price a swap one way in a quote request and another at settlement.
          </footer>
        </blockquote>
      </section>

      <section className="space-y-4" aria-labelledby="example">
        <h2 id="example" className="text-xl font-bold">
          The same trade, with and without protection
        </h2>
        {h ? (
          <>
            <p className="max-w-3xl text-sm text-mute" data-testid="example-text">
              Swap {fmt(h.amountIn, 0)} tUSD. Pool {h.rejectedPool} quoted <strong className="text-ink">{fmt(h.quoted, 1)}</strong>, the best price. Its hook took {pct(BigInt(h.shortfallBps))} when
              the swap really executed. Pool {h.filledPool} quoted less and kept its word.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card border-bad/50 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-bad">Unprotected router (trusts the best quote)</p>
                <p className="mono mt-2 text-4xl font-extrabold text-bad" data-testid="raw-number">
                  {fmt(h.rawOut, 1)}
                </p>
                <p className="mt-1 text-sm text-mute">tUSDC received.</p>
                <p className="mt-2 text-xs"><ExplorerTxLink hash={h.rawTx.hash} label="On-chain:" /></p>
              </div>
              <div className="card border-ok/50 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-ok">FIRM (checks the fill against the quote)</p>
                <p className="mono mt-2 text-4xl font-extrabold text-ok" data-testid="firm-number">
                  {fmt(h.firmOut, 1)}
                </p>
                <p className="mt-1 text-sm text-mute">
                  tUSDC received: Pool {h.rejectedPool} rejected and struck, Pool {h.filledPool} filled, one transaction. <strong className="text-ink">{fmt(h.saved, 1)} more.</strong>
                </p>
                <p className="mt-2 text-xs"><ExplorerTxLink hash={h.firmTx.hash} label="On-chain:" /></p>
              </div>
            </div>
            <p className="max-w-3xl text-xs text-mute">
              Read from the receipts of two real transactions on Monad Testnet ({new Date(h.rawTx.timestamp * 1000).toISOString().slice(0, 10)}). Pool {h.rejectedPool} is a test hook we
              wrote to behave this way, so this shows the mechanism works; it does not show that real third-party hooks are caught, and one trade is not a benchmark.
            </p>
          </>
        ) : (
          <p className="text-sm text-mute" data-testid="example-text">
            Evidence from the real transactions is generated with <span className="mono">scripts/build-evidence.mjs</span>; none has been generated for this build, so no number is shown.
          </p>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="who">
        <h2 id="who" className="text-xl font-bold">
          Who pays for the problem, and who gets what
        </h2>
        <div className="grid gap-4 md:grid-cols-3" data-testid="audiences">
          {AUDIENCES.map((a) => (
            <div key={a.who} className="card space-y-2 p-4">
              <p className="font-semibold">{a.who}</p>
              <p className="text-sm text-mute"><strong className="text-bad">Today:</strong> {a.pain}</p>
              <p className="text-sm text-mute"><strong className="text-ok">With FIRM:</strong> {a.gain}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm text-mute">
          The wedge is that a router adopts FIRM in two lines, <span className="mono">statusOf(hook)</span> and <span className="mono">toleranceBps(hook)</span>, and every
          router that does makes the scoreboard more valuable to the next one. <Link href="/integrate">See how to integrate</Link>.
        </p>
      </section>

      <CostCard />

      <section className="space-y-3" aria-labelledby="how">
        <h2 id="how" className="text-xl font-bold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ["Quote, then fill", "For each candidate pool FirmRouter asks the V4 Quoter inside the transaction, then swaps at the same state."],
            ["Reject and strike", "If the real output is below the pool's own quote (within a small tolerance), only that leg is undone, the shortfall is a public strike on the Scoreboard, and the next pool is tried."],
            ["Probe the rest", "A canary sends dust swaps from rotating sender addresses to catch hooks that are honest only to routers they recognise."],
          ].map(([t, p], i) => (
            <li key={t} className="card p-4">
              <p className="mono text-xs text-mute">{i + 1}</p>
              <p className="mt-1 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-mute">{p}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3" aria-labelledby="limits">
        <h2 id="limits" className="text-xl font-bold">
          What FIRM does not catch
        </h2>
        <ul className="card max-w-3xl list-disc space-y-1 p-5 pl-9 text-sm text-mute" data-testid="limits">
          <li>
            A hook that is honest to the Quoter <em>and</em> to FirmRouter but cheats everyone else. In our benchmark the router missed our fixture of this kind 20 times out of 20; only the
            canary, probing from other addresses, caught it.
          </li>
          <li>A hook that recognises the canary&apos;s probes. That is an arms race, not a solved problem.</li>
          <li>A hook that is expensive but consistent: FIRM measures promise-keeping, not price quality.</li>
          <li>The owner of the Scoreboard is a trusted role: it cannot move user funds, but it can add reporters and reinstate hooks.</li>
        </ul>
        <p className="text-sm"><Link href="/proof">All measurements and limits, with sources</Link></p>
      </section>

      <section className="space-y-3" aria-labelledby="built">
        <h2 id="built" className="text-xl font-bold">
          Built on
        </h2>
        <ul className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <li className="card p-3"><strong>Monad Testnet</strong><span className="block text-xs text-mute">{dep ? "37 transactions deployed, 14 contracts verified" : "not deployed in this build"}</span></li>
          <li className="card p-3"><strong>Envio HyperIndex + HyperSync</strong><span className="block text-xs text-mute">powers the leaderboard, activity feed and hook pages</span></li>
          <li className="card p-3"><strong>Uniswap v4</strong><span className="block text-xs text-mute">Monad-maintained testnet deployment, not official</span></li>
          <li className="card p-3"><strong>Claude Code</strong><span className="block text-xs text-mute">AI coding tools were used to build this project</span></li>
        </ul>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/demo" className="btn btn-primary no-underline">Try the demo</Link>
        </div>
      </section>
    </div>
  );
}
