import Link from "next/link";
import { CityMap } from "@/components/city/CityMap";
import { MonadBackdrop, UniswapBackdrop } from "@/components/city/Backdrops";
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
    gain: "A swap that either delivers what its pool quoted or falls back to another pool, in the same transaction. A failed leg never puts their funds at risk.",
  },
  {
    who: "Routers, aggregators and wallets",
    pain: "They rank pools by a quote they cannot verify, then carry the support burden when users get less than shown.",
    gain: "A public, on-chain Scoreboard any router can read (statusOf, toleranceBps) before it routes, or FirmRouter as the execution layer. No permission, no API key.",
  },
  {
    who: "Honest hook builders and liquidity providers",
    pain: "Honest hooks are lumped in with the 54% that 0x flagged as malicious, and honest pools lose flow to cheats that quote better.",
    gain: "A public track record earned from real fills and canary probes, with a path back from a wrongly struck status.",
  },
];

/** The pools of the seeded demo, by role. Pool letters come from deployments/10143.json; the labels say what each fixture does. */
const POOL_ROLES: Record<string, { label: string; tone: string }> = {
  B: { label: "hidden 18% fee", tone: "border-bad text-bad" },
  G: { label: "burns all gas", tone: "border-bad text-bad" },
  R: { label: "reverts", tone: "border-bad text-bad" },
  D: { label: "random fee", tone: "border-warn text-warn" },
  E: { label: "honest to routers only", tone: "border-warn text-warn" },
  Q: { label: "quotes high to simulations", tone: "border-warn text-warn" },
  C: { label: "honest", tone: "border-ok text-ok" },
};

const FEATURES = [
  { t: "Check inside the swap", p: "FirmRouter asks the V4 Quoter for each pool's quote in the same transaction, swaps at the identical state, and reverts only the leg that came up short.", tag: "FirmRouter" },
  { t: "Strike in public", p: "A shortfall is a permanent strike on the Scoreboard. A severe or repeated one BLOCKS the hook for every router, and the owner can undo a wrong call.", tag: "Scoreboard" },
  { t: "Fall back, never fail", p: "A hook that burns gas, reverts or returns junk cannot stop the swap: each leg runs under a gas cap and the router tries the next pool.", tag: "Gas caps" },
  { t: "Probe before users arrive", p: "A canary swaps dust from several sender addresses to catch hooks that are honest only to routers they recognise.", tag: "CanaryRunner" },
  { t: "Powered by Envio", p: "HyperIndex reads Monad through HyperSync for the leaderboard, activity feed and hook pages, and the page prints how far behind the chain it is.", tag: "HyperSync" },
  { t: "Every claim has a link", p: "Two real transactions, source-verified contracts and measured gas, each linked to the block explorer. We also list what we did not run.", tag: "Proof" },
  { t: "Adopt in two reads", p: "statusOf(hook) and toleranceBps(hook) are the whole integration for a router that wants the signal without using our router.", tag: "Integrate" },
  { t: "Built for agents", p: "An MCP tool server gives an AI agent one swap tool that goes through FIRM, so a confused agent cannot skip the check.", tag: "MCP" },
];

export default function Landing() {
  const h = headline(evidence);
  const dep = deployments;
  const verified = dep ? [...Object.values(dep.core), ...Object.values(dep.fixtures)].filter((e) => e.verification === "verified").length : 0;
  const pools = dep ? Object.entries(dep.pools.list).filter(([n, p]) => POOL_ROLES[n] && p.hook !== "0x0000000000000000000000000000000000000000") : [];

  return (
    <div className="space-y-28 sm:space-y-36">
      {/* ------------------------------------------------ hero */}
      <section className="space-y-8 pt-4 text-center" aria-labelledby="pitch">
        <p className="pill mx-auto" data-testid="hero-eyebrow">
          <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
          Live on Monad Testnet, built on Uniswap v4 hooks
        </p>
        <h1 id="pitch" className="display mx-auto max-w-4xl text-4xl sm:text-6xl">
          A quote is a promise. <span className="text-brand">FIRM</span> makes pools keep it.
        </h1>
        <p className="lead mx-auto max-w-2xl">
          FIRM is a Uniswap v4 router and a public scoreboard for Monad. It checks every pool&apos;s quote against its real fill inside the same transaction, strikes the hooks that
          break their word, and falls back to an honest pool.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/demo" className="btn btn-primary btn-lg no-underline" data-testid="try-demo">
            Try the demo
          </Link>
          <Link href="/proof" className="btn btn-lg no-underline">
            See the proof on Monad
          </Link>
        </div>
        <div className="pt-4 text-left">
          <CityMap />
        </div>
      </section>

      {/* ------------------------------------------------ in plain words */}
      <section aria-labelledby="plain" data-testid="plain-words">
        <div className="section-head">
          <p className="eyebrow">In plain words</p>
          <h2 id="plain" className="display text-3xl sm:text-4xl">Think of a shop with two prices</h2>
          <p className="lead mx-auto max-w-2xl">
            The label says 999. At the till you are charged for 819. Nobody told you, and the next customer is caught the same way. FIRM stands at the till for you.
          </p>
        </div>
        <ol className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
          {[
            { n: "1", t: "Ask the price", p: "Before swapping, FIRM asks each pool: how much will I get? That answer is the promise." },
            { n: "2", t: "Check the till", p: "FIRM does the swap and compares what really arrived with the promise, in the same transaction. Too little means that leg is undone." },
            { n: "3", t: "Name it, move on", p: "The pool that broke its word is marked on a public scoreboard, and FIRM tries the next honest pool. You still get your swap." },
          ].map((s) => (
            <li key={s.n} className="card space-y-4 p-7">
              <span className="step-num" aria-hidden>{s.n}</span>
              <h3 className="text-xl font-bold">{s.t}</h3>
              <p className="copy">{s.p}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------ who pays */}
      <section aria-labelledby="who">
        <div className="section-head">
          <p className="eyebrow">Who it is for</p>
          <h2 id="who" className="display text-3xl sm:text-4xl">Built for the people who pay for the lie</h2>
          <p className="lead mx-auto max-w-2xl">The cost lands on whoever trusts the quote, and the fix lands where the routing decision is made.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3" data-testid="audiences">
          {AUDIENCES.map((a) => (
            <div key={a.who} className="card space-y-4 p-7">
              <p className="text-xl font-bold">{a.who}</p>
              <p className="copy"><strong className="text-bad">Today:</strong> {a.pain}</p>
              <p className="copy"><strong className="text-ok">With FIRM:</strong> {a.gain}</p>
            </div>
          ))}
        </div>
        <p className="copy mx-auto mt-10 max-w-3xl text-center">
          The wedge: a router adopts FIRM in two lines, <span className="mono">statusOf(hook)</span> and <span className="mono">toleranceBps(hook)</span>, and every router that does
          makes the scoreboard more valuable to the next one. <Link href="/integrate">See how to integrate</Link>.
        </p>
      </section>

      {/* ------------------------------------------------ the evidence quote */}
      <section aria-labelledby="evidence">
        <h2 id="evidence" className="sr-only">The evidence</h2>
        <blockquote className="card mx-auto max-w-4xl p-8 text-center" style={{ background: "var(--color-panel2)" }}>
          <p className="display text-2xl sm:text-3xl">
            0x analysed 84,163 Uniswap v4 hooks and classified <span className="text-bad">54.2% as malicious</span> and a further{" "}
            <span className="text-bad">26.4% as &ldquo;likely malicious&rdquo;</span>.
          </p>
          <footer className="mx-auto mt-4 max-w-2xl text-xs text-mute">
            0x, &ldquo;Uniswap v4 hooks were a mistake&rdquo;, 14 September 2026 (data as of 11 September; 19.4% safe; 6 chains).{" "}
            <a href="https://0x.org/post/uniswap-v4-hooks-were-a-mistake" target="_blank" rel="noreferrer">Read it</a>. This is 0x&apos;s classification, not ours. Uniswap&apos;s founder disputes the framing, noting
            that the count includes hooks with little activity (via Crypto Briefing). 0x also describes hooks that price a swap one way in a quote request and another at settlement, which is the case FIRM is built for.
          </footer>
        </blockquote>
      </section>

      {/* ------------------------------------------------ practise villains */}
      {pools.length > 0 ? (
        <section className="space-y-4 text-center" aria-labelledby="villains">
          <h2 id="villains" className="display text-3xl sm:text-4xl">Sure, we brought some villains to practise on</h2>
          <p className="mx-auto max-w-2xl text-sm text-mute">
            Seven of the pools on Monad Testnet use hooks we wrote: honest ones and ones that cheat in different ways. They exist only as test fixtures, so you can watch FIRM catch them.
          </p>
          <ul className="flex flex-wrap justify-center gap-2" data-testid="villain-pills">
            {pools.map(([n, p]) => (
              <li key={n}>
                <Link href={`/hooks/${p.hook}`} className={`pill no-underline ${POOL_ROLES[n]!.tone}`}>
                  Pool {n} · {POOL_ROLES[n]!.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------ where the lie happens */}
      <section className="space-y-4" aria-labelledby="problem">
        <div className="section-head">
          <h2 id="problem" className="display text-3xl sm:text-4xl">The problem, and exactly where it happens</h2>
          <p className="lead mx-auto max-w-2xl">One swap, two paths, one hook that can tell them apart.</p>
        </div>
        <LieDiagram />
      </section>

      {/* ------------------------------------------------ the numbers */}
      <section className="space-y-4" aria-labelledby="example">
        <div className="section-head">
          <h2 id="example" className="display text-3xl sm:text-4xl">The same trade, with and without protection</h2>
        </div>
        {h ? (
          <>
            <p className="mx-auto max-w-3xl text-center text-sm text-mute" data-testid="example-text">
              Swap {fmt(h.amountIn, 0)} tUSD. Pool {h.rejectedPool} quoted <strong className="text-ink">{fmt(h.quoted, 1)}</strong>, the best price. Its hook took {pct(BigInt(h.shortfallBps))} when
              the swap really executed. Pool {h.filledPool} quoted less and kept its word.
            </p>
            <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
              <div className="card border-bad/50 p-6">
                <p className="text-xs font-bold uppercase tracking-wide text-bad">Unprotected router (trusts the best quote)</p>
                <p className="mono mt-2 text-5xl font-extrabold text-bad" data-testid="raw-number">{fmt(h.rawOut, 1)}</p>
                <p className="mt-1 text-sm text-mute">tUSDC received.</p>
                <p className="mt-2 text-xs"><ExplorerTxLink hash={h.rawTx.hash} label="On-chain:" /></p>
              </div>
              <div className="card border-ok/50 p-6">
                <p className="text-xs font-bold uppercase tracking-wide text-ok">FIRM (checks the fill against the quote)</p>
                <p className="mono mt-2 text-5xl font-extrabold text-ok" data-testid="firm-number">{fmt(h.firmOut, 1)}</p>
                <p className="mt-1 text-sm text-mute">
                  tUSDC received: Pool {h.rejectedPool} rejected and struck, Pool {h.filledPool} filled, one transaction. <strong className="text-ink">{fmt(h.saved, 1)} more.</strong>
                </p>
                <p className="mt-2 text-xs"><ExplorerTxLink hash={h.firmTx.hash} label="On-chain:" /></p>
              </div>
            </div>
            <p className="mx-auto max-w-3xl text-center text-xs text-mute">
              Read from the receipts of two real transactions on Monad Testnet ({new Date(h.rawTx.timestamp * 1000).toISOString().slice(0, 10)}). Pool {h.rejectedPool} is a test hook we wrote to
              behave this way, so this shows the mechanism works; it does not show that real third-party hooks are caught, and one trade is not a benchmark.
            </p>
          </>
        ) : (
          <p className="text-center text-sm text-mute" data-testid="example-text">
            Evidence from the real transactions is generated with <span className="mono">scripts/build-evidence.mjs</span>; none has been generated for this build, so no number is shown.
          </p>
        )}
      </section>

      {/* ------------------------------------------------ features */}
      <section aria-labelledby="features">
        <div className="section-head">
          <h2 id="features" className="display text-3xl sm:text-4xl">What is inside</h2>
          <p className="lead mx-auto max-w-2xl">Deterministic contracts decide money and status. Nothing here asks you to trust a model, an oracle or us.</p>
        </div>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" data-testid="features">
          {FEATURES.map((f, i) => (
            <li key={f.t} className={`card flex flex-col gap-3 p-7 ${i === 0 ? "lg:col-span-2" : ""} ${i === 5 ? "lg:col-span-2" : ""}`}>
              <span className="pill w-fit">{f.tag}</span>
              <p className="text-lg font-bold">{f.t}</p>
              <p className="copy">{f.p}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------ focus: Uniswap, Monad, Envio */}
      <section className="space-y-8" aria-labelledby="focus">
        <div className="section-head">
          <h2 id="focus" className="display text-3xl sm:text-4xl">What we focus on, and why</h2>
          <p className="lead mx-auto max-w-3xl">
            One problem: a quote that a hook can falsify. We use the infrastructure that problem needs, and nothing else.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3" data-testid="focus-cards">
          <article className="card relative overflow-hidden p-8" data-testid="focus-uniswap">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32"><UniswapBackdrop /></div>
            <div className="relative space-y-3 pb-28">
              <span className="pill">Uniswap v4</span>
              <h3 className="text-xl font-bold">Hooks make pools programmable, and quotable lies possible</h3>
              <p className="text-sm text-mute">
                A v4 pool can attach a hook that runs inside the swap and changes what it delivers. That is the feature, and it is also the attack surface: the quote and the fill can differ.
                FIRM looks at exactly that gap and nothing else.
              </p>
              <p className="text-xs text-mute">
                On Monad Testnet the PoolManager and Quoter are Monad-maintained deployments{dep ? <> (<span className="mono">{dep.infra.poolManager.slice(0, 8)}…</span>)</> : null}, not official Uniswap ones. FIRM is not affiliated with Uniswap Labs.
              </p>
            </div>
          </article>
          <article className="card relative overflow-hidden p-8" data-testid="focus-monad">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32"><MonadBackdrop /></div>
            <div className="relative space-y-3 pb-28">
              <span className="pill">Monad</span>
              <h3 className="text-xl font-bold">Per-swap verification only works where blocks are fast and cheap</h3>
              <p className="text-sm text-mute">
                FIRM does more work per swap: a quote and a check for every pool it tries, plus a Scoreboard write. Fast blocks make a strike visible within a block or two.
                {dep ? ` Deployed on chain 10143 with ${verified} source-verified contracts.` : ""}
              </p>
              <p className="text-xs text-mute">Honest caveat: Monad charges the gas limit, so protection costs more. The cost card below shows what we measured on the public testnet.</p>
            </div>
          </article>
          <article className="card relative overflow-hidden p-8" data-testid="focus-envio">
            <div className="relative space-y-3">
              <span className="pill">Envio</span>
              <h3 className="text-xl font-bold">A public scoreboard needs a fast, honest index</h3>
              <p className="text-sm text-mute">
                HyperIndex over HyperSync turns on-chain strikes, fills and probes into a leaderboard, a live feed and a page per hook. The index is display only: no contract reads it.
              </p>
              <p className="text-xs text-mute">We compare the index with the Scoreboard contract hook by hook, and the app prints which source answered and its lag.</p>
              <Link href="/leaderboard" className="btn mt-1 no-underline">Open the leaderboard</Link>
            </div>
          </article>
        </div>
        <div className="card mx-auto max-w-4xl p-6" data-testid="not-doing">
          <p className="font-bold">What we deliberately do not do</p>
          <ul className="mt-2 grid gap-x-8 gap-y-1 text-sm text-mute sm:grid-cols-2">
            <li>We do not promise a better price: FIRM measures promise-keeping, not price quality.</li>
            <li>We do not protect from MEV or sandwiching.</li>
            <li>We do not use an oracle or an off-chain price: the check is the pool against its own quote.</li>
            <li>We do not hold your funds: the router holds nothing between calls, and the owner cannot move user tokens.</li>
            <li>We do not claim to catch real third-party malicious hooks: our cheats are our own fixtures.</li>
            <li>We do not hide the cost: protection uses more gas, and the numbers are on this page.</li>
          </ul>
        </div>
      </section>

      <CostCard />

      {/* ------------------------------------------------ limits */}
      <section className="space-y-3" aria-labelledby="limits">
        <h2 id="limits" className="display text-3xl text-center">What FIRM does not catch</h2>
        <ul className="card mx-auto max-w-3xl list-disc space-y-1 p-6 pl-10 text-sm text-mute" data-testid="limits">
          <li>
            A hook that is honest to the Quoter <em>and</em> to FirmRouter but cheats everyone else. In our benchmark the router missed our fixture of this kind 20 times out of 20; only the
            canary, probing from other addresses, caught it.
          </li>
          <li>A hook that recognises the canary&apos;s probes. That is an arms race, not a solved problem.</li>
          <li>A hook that is expensive but consistent: FIRM measures promise-keeping, not price quality.</li>
          <li>The owner of the Scoreboard is a trusted role: it cannot move user funds, but it can add reporters and reinstate hooks.</li>
        </ul>
        <p className="text-center text-sm"><Link href="/proof">All measurements and limits, with sources</Link></p>
      </section>

      {/* ------------------------------------------------ integration tiers */}
      <section className="space-y-8" aria-labelledby="tiers">
        <div className="section-head">
          <h2 id="tiers" className="display text-3xl sm:text-4xl">How much effort is it to use?</h2>
          <p className="lead mx-auto max-w-2xl">Pick the depth that fits your router.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3" data-testid="tiers">
          {[
            { n: "No sweat", d: "Read the scoreboard", p: "Call statusOf(hook) and toleranceBps(hook) before you route. Two view calls, no permission, no key.", c: "border-ok" },
            { n: "Some sweat", d: "Execute through FirmRouter", p: "Pass up to four candidate pools to swapExactIn. It checks each quote against its fill and falls back for you.", c: "border-warn" },
            { n: "Real sweat", d: "Run your own canary and index", p: "Deploy a CanaryRunner, point Envio at your deployment, and keep your own evidence of who keeps their word.", c: "border-bad" },
          ].map((t) => (
            <div key={t.n} className={`card border-t-4 p-7 ${t.c}`}>
              <p className="text-xs font-bold uppercase tracking-wide text-mute">{t.n}</p>
              <p className="mt-1 text-lg font-bold">{t.d}</p>
              <p className="copy mt-2">{t.p}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-sm"><Link href="/integrate">Code samples, addresses and ABIs</Link></p>
      </section>

      {/* ------------------------------------------------ final call */}
      <section className="card mx-auto max-w-4xl space-y-4 p-10 text-center" style={{ background: "var(--color-cream)" }} aria-labelledby="cta">
        <h2 id="cta" className="display text-3xl sm:text-4xl">Watch it catch a cheat in three minutes</h2>
        <p className="mx-auto max-w-xl text-sm text-mute" style={{ color: "var(--color-plum)" }}>
          Connect a wallet on Monad Testnet, mint test tokens, run the same trade through an unprotected router and through FIRM, and check every step on the block explorer.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/demo" className="btn btn-primary btn-lg no-underline">Start the guided demo</Link>
          <Link href="/leaderboard" className="btn btn-lg no-underline">Hook leaderboard</Link>
        </div>
      </section>
    </div>
  );
}
