"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExplorerTxLink } from "@/components/TxLink";
import { deployments } from "@/lib/deployments";
import { evidence, headline } from "@/lib/evidence";
import { fmt, pct } from "@/lib/format";

const REPO = "https://github.com/AZAR2305/FIRM";

/** protected / raw gas limit across the pools measured on the real testnet: the range we print, never a single flattering number */
function overheadRange(): { lo: string; hi: string } | null {
  const pools = evidence?.recorded.firstTouch.pools;
  if (!pools) return null;
  const r = Object.values(pools).filter((p) => p.raw > 0 && p.protected > 0).map((p) => p.protected / p.raw);
  if (r.length === 0) return null;
  return { lo: Math.min(...r).toFixed(2), hi: Math.max(...r).toFixed(2) };
}

function Slide({ eyebrow, title, children }: { eyebrow: string; title?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[26rem] w-full max-w-5xl flex-col justify-center gap-8 py-6 sm:min-h-[32rem]">
      <div className="space-y-4 text-center">
        <p className="eyebrow">{eyebrow}</p>
        {title ? <h2 className="display text-3xl sm:text-5xl">{title}</h2> : null}
      </div>
      {children}
    </div>
  );
}

export function PitchDeck() {
  const h = headline(evidence);
  const oh = overheadRange();
  const verified = deployments ? [...Object.values(deployments.core), ...Object.values(deployments.fixtures)].filter((e) => e.verification === "verified").length : 0;

  const slides: { id: string; node: ReactNode }[] = [
    {
      id: "title",
      node: (
        <div className="mx-auto flex min-h-[26rem] w-full max-w-5xl flex-col items-center justify-center gap-7 text-center sm:min-h-[32rem]">
          <p className="eyebrow">Monad Metropolis · Track 1 · Onchain finance and trading</p>
          <div className="flex items-center justify-center gap-4 sm:gap-8">
            <Image src="/firm-mark.png" alt="" width={326} height={416} unoptimized className="h-[5.5rem] w-auto sm:h-[10rem]" />
            <h1 className="display text-[5.5rem] leading-none sm:text-[10rem]" data-testid="pitch-title">FIRM</h1>
          </div>
          <p className="display text-2xl sm:text-4xl">A quote is a promise. FIRM makes pools keep it.</p>
          <p className="lead mono max-w-3xl text-base">
            A Uniswap v4 router and a public scoreboard for Monad. It checks each pool&apos;s quote against its real fill inside the same transaction, strikes the hooks that lie, and
            falls back to an honest pool.
          </p>
          <ul className="flex flex-wrap justify-center gap-3">
            <li className="pill"><strong>Uniswap v4</strong> hooks are the attack surface</li>
            <li className="pill"><strong>Monad</strong> makes a check per swap affordable</li>
            <li className="pill"><strong>Envio</strong> indexes the public scoreboard</li>
          </ul>
        </div>
      ),
    },
    {
      id: "problem",
      node: (
        <Slide eyebrow="The problem" title="One swap, two prices.">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="card space-y-3 p-8 text-center">
              <p className="eyebrow">What the quote promised</p>
              <p className="mono display text-5xl sm:text-6xl">{h ? fmt(h.quoted, 1) : "999"}</p>
              <p className="copy">the best price a router saw, from a simulation</p>
            </div>
            <div className="card space-y-3 border-bad/60 p-8 text-center">
              <p className="eyebrow text-bad">What the swap delivered</p>
              <p className="mono display text-5xl text-bad sm:text-6xl">{h ? fmt(h.rawOut, 1) : "819"}</p>
              <p className="copy">through an unprotected router, same trade, on Monad Testnet</p>
            </div>
          </div>
          <p className="lead mx-auto max-w-3xl text-center">
            A v4 hook runs inside the swap and can change the amounts. It can answer the simulation one way and the real swap another. The trader loses the difference silently, and no
            router remembers which hook did it.
          </p>
          <p className="copy mx-auto max-w-3xl text-center text-sm">
            0x classified 54.2% of 84,163 analysed v4 hooks as malicious and 26.4% more as likely malicious (as of 11 Sep 2026). That is 0x&apos;s classification, not ours, and Uniswap&apos;s
            founder disputes it.
          </p>
        </Slide>
      ),
    },
    {
      id: "solution",
      node: (
        <Slide eyebrow="The fix" title="Check the till, in the same transaction.">
          <ol className="grid gap-6 md:grid-cols-3">
            {[
              { n: "1", t: "Ask", p: "FIRM asks the Uniswap V4 Quoter what each pool will pay, inside the swap transaction. That is the promise." },
              { n: "2", t: "Check", p: "It swaps at the identical state and compares the real fill with the promise. Too little: only that leg reverts, and the hook is struck on the Scoreboard." },
              { n: "3", t: "Fall back", p: "A hook that reverts or burns gas hits a gas cap. FIRM tries the next pool, so the trader still gets a fill from an honest one." },
            ].map((s) => (
              <li key={s.n} className="card space-y-4 p-7">
                <span className="step-num" aria-hidden>{s.n}</span>
                <h3 className="text-xl font-bold">{s.t}</h3>
                <p className="copy">{s.p}</p>
              </li>
            ))}
          </ol>
          <p className="copy mx-auto max-w-3xl text-center">
            Deterministic contracts decide money and status. A canary also probes hooks with dust swaps from several senders, to catch hooks that are honest only to routers they recognise.
          </p>
        </Slide>
      ),
    },
    {
      id: "proof",
      node: (
        <Slide eyebrow="Proof on Monad Testnet" title="The same trade, two transactions.">
          {h ? (
            <>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="card space-y-2 border-bad/60 p-8 text-center">
                  <p className="eyebrow text-bad">Unprotected router</p>
                  <p className="mono display text-5xl text-bad sm:text-6xl" data-testid="pitch-raw">{fmt(h.rawOut, 1)}</p>
                  <p className="copy text-sm">tUSDC for {fmt(h.amountIn, 0)} tUSD</p>
                  <p className="text-xs"><ExplorerTxLink hash={h.rawTx.hash} label="On-chain:" /></p>
                </div>
                <div className="card space-y-2 border-ok/60 p-8 text-center">
                  <p className="eyebrow text-ok">FIRM</p>
                  <p className="mono display text-5xl text-ok sm:text-6xl" data-testid="pitch-firm">{fmt(h.firmOut, 1)}</p>
                  <p className="copy text-sm">
                    Pool {h.rejectedPool} rejected (quoted {fmt(h.quoted, 1)}, delivered {fmt(h.delivered, 1)}, {pct(BigInt(h.shortfallBps))} short) and struck. Pool {h.filledPool} filled.
                  </p>
                  <p className="text-xs"><ExplorerTxLink hash={h.firmTx.hash} label="On-chain:" /></p>
                </div>
              </div>
              <p className="lead mx-auto max-w-3xl text-center">
                {fmt(h.saved, 1)} more for the trader.{oh ? ` Protection is not free: Monad charges the gas limit, and a protected swap needed ${oh.lo}x to ${oh.hi}x the limit of an unprotected one (eth_estimateGas, first touch).` : ""}
              </p>
              <p className="copy mx-auto max-w-3xl text-center text-sm">
                One trade is not a benchmark. Pool {h.rejectedPool} is a test hook we wrote to behave this way: it shows the mechanism works, not that real third-party hooks are caught.
              </p>
            </>
          ) : (
            <p className="copy text-center">No evidence file was generated for this build, so no number is shown.</p>
          )}
        </Slide>
      ),
    },
    {
      id: "stack",
      node: (
        <Slide eyebrow="What is live" title="Everything is checkable.">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="card space-y-3 p-7">
              <span className="pill w-fit">Contracts</span>
              <p className="text-xl font-bold">{verified > 0 ? `${verified} verified` : "Deployed"}</p>
              <p className="copy">Scoreboard, FirmRouter, CanaryRunner and the unprotected comparator, on chain 10143 with source on Sourcify. One command redeploys all of it.</p>
            </div>
            <div className="card space-y-3 p-7">
              <span className="pill w-fit">Envio HyperIndex</span>
              <p className="text-xl font-bold">Hosted index</p>
              <p className="copy">The leaderboard, activity feed and hook pages read Envio. The page prints the indexed block and how far behind the chain it is. All 7 hooks match the Scoreboard.</p>
              <Link href="/leaderboard" className="btn w-fit no-underline">Open the leaderboard</Link>
            </div>
            <div className="card space-y-3 p-7">
              <span className="pill w-fit">Uniswap v4 and Monad</span>
              <p className="text-xl font-bold">Real pools</p>
              <p className="copy">Seven seeded pools on Monad&apos;s maintained v4 deployment (not official Uniswap): honest hooks and our own cheating fixtures.</p>
              <Link href="/demo" className="btn w-fit no-underline">Run the demo</Link>
            </div>
          </div>
        </Slide>
      ),
    },
    {
      id: "limits",
      node: (
        <Slide eyebrow="Honest limits and next steps" title="What we do not claim.">
          <ul className="card mx-auto grid max-w-4xl gap-x-10 gap-y-3 p-8 text-sm sm:grid-cols-2">
            {[
              "The 20-trial benchmark ran on a fork, not on the testnet. One real trade ran on the testnet.",
              "Our cheating hooks are our own fixtures. We have not shown that real malicious hooks are caught.",
              "A hook honest to the router but not to everyone else is caught only by the canary, and a hook that recognises probes defeats it.",
              "One owner key controls the Scoreboard: it cannot move user funds, but there is no timelock or multisig yet.",
            ].map((t) => (
              <li key={t} className="copy">{t}</li>
            ))}
          </ul>
          <p className="copy mx-auto max-w-3xl text-center text-sm">Built with AI coding tools (Claude Code). The README lists all pre-existing code and libraries.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/demo" className="btn btn-primary btn-lg no-underline">Try the guided demo</Link>
            <Link href="/proof" className="btn btn-lg no-underline">See the proof</Link>
            <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-lg no-underline">Source code</a>
          </div>
        </Slide>
      ),
    },
  ];

  const last = slides.length - 1;
  const [i, setI] = useState(0);
  const deck = useRef<HTMLElement>(null);

  const go = useCallback((n: number) => {
    const c = Math.max(0, Math.min(last, n));
    setI(c);
    try {
      history.replaceState(null, "", `#${c + 1}`);
    } catch {
      /* some embedded browsers block history changes: navigation still works */
    }
  }, [last]);

  // read the slide from the address (#2 is the second slide) on load and when it changes
  useEffect(() => {
    const read = () => {
      const n = Number.parseInt(window.location.hash.slice(1), 10);
      if (Number.isFinite(n)) setI(Math.max(0, Math.min(last, n - 1)));
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [last]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void deck.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(i + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(i - 1);
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, i, toggleFullscreen]);

  return (
    <section ref={deck} aria-roledescription="carousel" aria-label="FIRM pitch" className="flex min-h-[calc(100vh-9rem)] flex-col justify-between gap-8 bg-bg" data-testid="pitch-deck">
      <div aria-live="polite" data-testid="pitch-slide" data-slide={i + 1}>
        {slides[i]!.node}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button type="button" className="btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide" data-testid="pitch-prev">←</button>
        <div className="flex items-center gap-2" role="group" aria-label="Slides">
          {slides.map((s, n) => (
            <button
              key={s.id}
              type="button"
              onClick={() => go(n)}
              aria-label={`Slide ${n + 1} of ${slides.length}`}
              aria-current={n === i ? "true" : undefined}
              className={`h-3 rounded-full border border-ink transition-all ${n === i ? "w-9 bg-ink" : "w-3 bg-transparent"}`}
            />
          ))}
        </div>
        <button type="button" className="btn" onClick={() => go(i + 1)} disabled={i === last} aria-label="Next slide" data-testid="pitch-next">→</button>
        <span className="mono hidden text-xs uppercase tracking-wider text-mute sm:inline">← → to move · F for fullscreen</span>
        <button type="button" className="btn sm:hidden" onClick={toggleFullscreen}>Fullscreen</button>
      </div>
    </section>
  );
}
