import Link from "next/link";
import { CostCard } from "@/components/CostCard";
import { HeroBoard } from "@/components/HeroBoard";
import { LieDiagram } from "@/components/LieDiagram";
import { ExplorerTxLink } from "@/components/TxLink";
import { deployments } from "@/lib/deployments";
import { evidence, headline } from "@/lib/evidence";
import { fmt, pct } from "@/lib/format";

const STEPS = [
  { n: "01", t: "Quote", p: "FirmRouter asks the Uniswap V4 Quoter what each candidate pool will pay, inside the swap transaction. That figure is the pool's promise." },
  { n: "02", t: "Verify", p: "It swaps at the identical state and compares the real fill with the promise. If a pool delivers less, only that leg reverts and the hook is struck on the Scoreboard." },
  { n: "03", t: "Fall back", p: "A hook that reverts or burns gas runs into a gas cap. The router moves on to the next pool, so the trade still fills with an honest one." },
];

const AUDIENCES = [
  {
    who: "Traders and trading agents",
    pain: "They accept a quote and receive less. The difference is silent, and an agent that always takes the best quote is the easiest target.",
    gain: "A swap that delivers what its pool quoted, or falls back to another pool in the same transaction.",
  },
  {
    who: "Routers, aggregators and wallets",
    pain: "They rank pools by a quote they cannot verify, then carry the support burden when users get less than shown.",
    gain: "A public Scoreboard any router can read (statusOf, toleranceBps) before routing, or FirmRouter as the execution layer. No permission, no API key.",
  },
  {
    who: "Honest hook builders and LPs",
    pain: "Honest hooks are lumped in with the 54% that 0x flagged, and honest pools lose flow to cheats that quote better.",
    gain: "A public track record earned from real fills and canary probes, with a path back from a wrongly struck status.",
  },
];

export default function Landing() {
  const h = headline(evidence);
  const dep = deployments;
  const verified = dep ? [...Object.values(dep.core), ...Object.values(dep.fixtures)].filter((e) => e.verification === "verified").length : 0;

  return (
    <div className="space-y-28 sm:space-y-36">
      {/* ------------------------------------------------ hero */}
      <section aria-labelledby="pitch" className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <div className="space-y-7">
          <p className="pill" data-testid="hero-eyebrow">
            <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
            Live on Monad Testnet
          </p>
          <h1 id="pitch" className="display text-4xl sm:text-5xl lg:text-[3.5rem]">
            Swap through Uniswap v4 hooks without trusting the quote.
          </h1>
          <p className="lead max-w-xl">
            FIRM is a router that checks every pool&apos;s quote against its real fill inside the same transaction. A pool that delivers less is rejected, struck on a public
            scoreboard, and skipped by the next swap.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/swap" className="btn btn-primary btn-lg no-underline" data-testid="launch-app">Launch app</Link>
            <Link href="/demo" className="btn btn-lg no-underline" data-testid="try-demo">Guided walkthrough</Link>
          </div>
          <p className="mono text-xs uppercase tracking-wider text-mute">Built on Uniswap v4 · Monad · Envio HyperIndex</p>
        </div>
        <HeroBoard />
      </section>

      {/* ------------------------------------------------ the problem */}
      <section aria-labelledby="problem" className="space-y-10">
        <div className="section-head !mb-0">
          <p className="eyebrow">The problem</p>
          <h2 id="problem" className="section-title">A quote is a simulation. The swap is real.</h2>
          <p className="lead">A v4 hook runs inside the swap and can change what it delivers. It can answer the simulation one way and the real swap another, and no router remembers which hook did it.</p>
        </div>
        <LieDiagram />
        <blockquote className="card p-7 sm:p-9">
          <p className="display text-xl sm:text-2xl">
            0x analysed 84,163 Uniswap v4 hooks and classified <span className="text-bad">54.2% as malicious</span> and a further{" "}
            <span className="text-bad">26.4% as &ldquo;likely malicious&rdquo;</span>.
          </p>
          <footer className="mt-4 max-w-3xl text-xs leading-relaxed text-mute">
            0x, &ldquo;Uniswap v4 hooks were a mistake&rdquo;, 14 September 2026 (data as of 11 September; 19.4% safe; 6 chains).{" "}
            <a href="https://0x.org/post/uniswap-v4-hooks-were-a-mistake" target="_blank" rel="noreferrer">Read it</a>. This is 0x&apos;s classification, not ours. Uniswap&apos;s founder disputes the framing, noting
            that the count includes hooks with little activity (via Crypto Briefing). 0x also describes hooks that price a swap one way in a quote request and another at settlement, which is the case FIRM is built for.
          </footer>
        </blockquote>
      </section>

      {/* ------------------------------------------------ the numbers */}
      <section aria-labelledby="example" className="space-y-8">
        <div className="section-head !mb-0">
          <p className="eyebrow">Measured on Monad Testnet</p>
          <h2 id="example" className="section-title">The same trade, with and without protection</h2>
        </div>
        {h ? (
          <>
            <p className="copy max-w-3xl" data-testid="example-text">
              Swap {fmt(h.amountIn, 0)} tUSD. Pool {h.rejectedPool} quoted <strong className="text-ink">{fmt(h.quoted, 1)}</strong>, the best price. Its hook took {pct(BigInt(h.shortfallBps))} when
              the swap really executed. Pool {h.filledPool} quoted less and kept its word.
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="card border-bad/40 p-7">
                <p className="eyebrow !text-bad">Unprotected router</p>
                <p className="mono mt-3 text-5xl font-bold text-bad" data-testid="raw-number">{fmt(h.rawOut, 1)}</p>
                <p className="mt-1 text-sm text-mute">tUSDC received, trusting the best quote.</p>
                <p className="mt-4 text-xs"><ExplorerTxLink hash={h.rawTx.hash} label="On-chain:" /></p>
              </div>
              <div className="card border-ok/40 p-7">
                <p className="eyebrow !text-ok">FIRM</p>
                <p className="mono mt-3 text-5xl font-bold text-ok" data-testid="firm-number">{fmt(h.firmOut, 1)}</p>
                <p className="mt-1 text-sm text-mute">
                  tUSDC received. Pool {h.rejectedPool} rejected and struck, Pool {h.filledPool} filled, one transaction: <strong className="text-ink">{fmt(h.saved, 1)} more.</strong>
                </p>
                <p className="mt-4 text-xs"><ExplorerTxLink hash={h.firmTx.hash} label="On-chain:" /></p>
              </div>
            </div>
            <p className="max-w-3xl text-xs leading-relaxed text-mute">
              Read from the receipts of two real transactions ({new Date(h.rawTx.timestamp * 1000).toISOString().slice(0, 10)}). Pool {h.rejectedPool} is a test hook we wrote to behave this way: this shows the
              mechanism works, not that real third-party hooks are caught, and one trade is not a benchmark.
            </p>
          </>
        ) : (
          <p className="copy" data-testid="example-text">
            Evidence from the real transactions is generated with <span className="mono">scripts/build-evidence.mjs</span>; none has been generated for this build, so no number is shown.
          </p>
        )}
      </section>

      {/* ------------------------------------------------ how it works */}
      <section aria-labelledby="how">
        <div className="section-head">
          <p className="eyebrow">How it works</p>
          <h2 id="how" className="section-title">Three steps, one transaction</h2>
          <p className="lead">Deterministic contracts decide money and status. Nothing here asks you to trust a model, an oracle or us.</p>
        </div>
        <ol className="card divide-hairline grid overflow-hidden md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="space-y-3 p-7 sm:p-8">
              <span className="step-num">{s.n}</span>
              <h3 className="text-xl font-semibold">{s.t}</h3>
              <p className="copy">{s.p}</p>
            </li>
          ))}
        </ol>
        <p className="copy mt-6 max-w-3xl">
          A canary also swaps dust from several sender addresses, to catch hooks that are honest only to routers they recognise. A strike BLOCKS a hook for every router, and the owner can undo a wrong call.
        </p>
      </section>

      {/* ------------------------------------------------ agent + business teasers */}
      <section aria-labelledby="agent" className="grid gap-5 md:grid-cols-2">
        <div className="card flex flex-col items-start gap-4 p-8" data-testid="agent-teaser">
          <p className="eyebrow">For agents</p>
          <h2 id="agent" className="text-2xl font-semibold tracking-tight">Swap by message</h2>
          <p className="copy">
            Write &ldquo;swap 250 tUSD to tUSDC and send it to 0x&hellip;&rdquo;. The agent reads it, quotes every pool through FIRM and prepares the swap. Your wallet signs; the agent holds no keys.
          </p>
          <Link href="/agent" className="btn no-underline">Open the agent</Link>
        </div>
        <div className="card flex flex-col items-start gap-4 p-8" data-testid="business-teaser">
          <p className="eyebrow">The business</p>
          <h2 className="text-2xl font-semibold tracking-tight">Who pays, and why</h2>
          <p className="copy">
            Quotes that lie are a silent fee on traders and agents. We lay out four ways this could earn, and say plainly that none is live and no customer has used it.
          </p>
          <Link href="/business" className="btn no-underline">Read the business case</Link>
        </div>
      </section>

      {/* ------------------------------------------------ who it is for */}
      <section aria-labelledby="who">
        <div className="section-head">
          <p className="eyebrow">Who it is for</p>
          <h2 id="who" className="section-title">The people who pay when a quote lies</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3" data-testid="audiences">
          {AUDIENCES.map((a) => (
            <div key={a.who} className="card space-y-4 p-7">
              <p className="text-lg font-semibold">{a.who}</p>
              <p className="copy"><strong className="font-semibold text-bad">Today.</strong> {a.pain}</p>
              <p className="copy"><strong className="font-semibold text-ok">With FIRM.</strong> {a.gain}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ built on */}
      <section aria-labelledby="focus" className="space-y-8">
        <div className="section-head !mb-0">
          <p className="eyebrow">What it is built on</p>
          <h2 id="focus" className="section-title">One problem, and only the infrastructure it needs</h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-3" data-testid="focus-cards">
          <article className="card space-y-3 p-7" data-testid="focus-uniswap">
            <span className="pill">Uniswap v4</span>
            <h3 className="text-lg font-semibold">Hooks make pools programmable, and quotable lies possible</h3>
            <p className="copy">
              A hook runs inside the swap and changes what it delivers. That is the feature and the attack surface: the quote and the fill can differ. FIRM looks at exactly that gap.
            </p>
            <p className="text-xs leading-relaxed text-mute">
              On Monad Testnet the PoolManager and Quoter are Monad-maintained deployments{dep ? <> (<span className="mono">{dep.infra.poolManager.slice(0, 8)}…</span>)</> : null}, not official Uniswap ones. FIRM is not affiliated with Uniswap Labs.
            </p>
          </article>
          <article className="card space-y-3 p-7" data-testid="focus-monad">
            <span className="pill">Monad</span>
            <h3 className="text-lg font-semibold">Per-swap verification needs fast, cheap blocks</h3>
            <p className="copy">
              Every swap does more work: a quote and a check for each pool tried, plus a Scoreboard write. Fast blocks make a strike visible within a block or two.
              {dep ? ` Deployed on chain 10143 with ${verified} source-verified contracts.` : ""}
            </p>
            <p className="text-xs leading-relaxed text-mute">Monad charges the gas limit, so protection costs more. The cost table below shows what we measured on the public testnet.</p>
          </article>
          <article className="card space-y-3 p-7" data-testid="focus-envio">
            <span className="pill">Envio</span>
            <h3 className="text-lg font-semibold">A public scoreboard needs a fast, honest index</h3>
            <p className="copy">HyperIndex over HyperSync turns on-chain strikes, fills and probes into the leaderboard, the live feed and a page per hook. No contract reads the index.</p>
            <p className="text-xs leading-relaxed text-mute">We compare the index with the Scoreboard contract hook by hook, and the app prints which source answered and its lag.</p>
          </article>
        </div>
        <div className="card p-7" data-testid="not-doing">
          <p className="font-semibold">What we deliberately do not do</p>
          <ul className="mt-3 grid gap-x-10 gap-y-2 text-sm leading-relaxed text-mute sm:grid-cols-2">
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
      <section aria-labelledby="limits">
        <div className="section-head">
          <p className="eyebrow">Limits</p>
          <h2 id="limits" className="section-title">What FIRM does not catch</h2>
        </div>
        <ul className="card list-disc space-y-2 p-7 pl-11 text-sm leading-relaxed text-mute" data-testid="limits">
          <li>
            A hook that is honest to the Quoter <em>and</em> to FirmRouter but cheats everyone else. In our benchmark the router missed our fixture of this kind 20 times out of 20; only the
            canary, probing from other addresses, caught it.
          </li>
          <li>A hook that recognises the canary&apos;s probes. That is an arms race, not a solved problem.</li>
          <li>A hook that is expensive but consistent: FIRM measures promise-keeping, not price quality.</li>
          <li>The owner of the Scoreboard is a trusted role: it cannot move user funds, but it can add reporters and reinstate hooks.</li>
        </ul>
        <p className="mt-5 text-sm"><Link href="/proof">All measurements and limits, with sources</Link></p>
      </section>

      {/* ------------------------------------------------ developers */}
      <section aria-labelledby="dev" className="grid items-center gap-10 lg:grid-cols-2">
        <div className="space-y-5">
          <p className="eyebrow">For routers and wallets</p>
          <h2 id="dev" className="section-title">Adopt it in two reads</h2>
          <p className="lead">
            You do not need our router to use the signal. Before routing through a hook, call <span className="mono text-ink">statusOf(hook)</span> and{" "}
            <span className="mono text-ink">toleranceBps(hook)</span> on the Scoreboard. Both are public view calls: no permission, no API key.
          </p>
          <Link href="/integrate" className="btn no-underline">Developer docs</Link>
        </div>
        <pre className="card overflow-x-auto p-6 text-[0.8rem] leading-relaxed text-mute">
          <code className="mono">{`const status = await client.readContract({
  address: scoreboard,
  abi: deployments.abis.Scoreboard,
  functionName: "statusOf",
  args: [hook],
}); // 0 UNRATED  1 NORMAL  2 WATCH  3 BLOCKED

if (status === 3) skipThisPool();`}</code>
        </pre>
      </section>

      {/* ------------------------------------------------ final call */}
      <section className="card space-y-5 p-10 text-center sm:p-14" aria-labelledby="cta">
        <h2 id="cta" className="section-title">Watch it catch a cheat in three minutes</h2>
        <p className="copy mx-auto max-w-xl">
          Connect a wallet on Monad Testnet, mint test tokens, run the same trade through an unprotected router and through FIRM, and check every step on the block explorer.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/swap" className="btn btn-primary btn-lg no-underline">Launch app</Link>
          <Link href="/leaderboard" className="btn btn-lg no-underline">Hook leaderboard</Link>
        </div>
      </section>
    </div>
  );
}
