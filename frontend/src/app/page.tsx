import Link from "next/link";

export default function Landing() {
  return (
    <div className="space-y-12">
      <section className="space-y-5" aria-labelledby="pitch">
        <h1 id="pitch" className="max-w-4xl text-3xl font-extrabold leading-tight sm:text-4xl">
          FIRM is a Uniswap v4 router for Monad that checks each pool&apos;s quote against its real fill inside the same transaction, strikes
          the hooks that break their word in public, and falls back to an honest pool.
        </h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/swap?demo=1" className="btn btn-primary no-underline" data-testid="try-demo">
            Try the demo
          </Link>
          <Link href="/leaderboard" className="btn no-underline">
            See the hook leaderboard
          </Link>
          <Link href="/integrate" className="btn no-underline">
            Integrate
          </Link>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="example">
        <h2 id="example" className="text-xl font-bold">
          The same trade, 819 versus 998
        </h2>
        <p className="max-w-3xl text-sm text-mute">
          Swap 1,000 tUSD. Pool B quotes the best price, 999.0. Its hook behaves differently when it really executes and takes a hidden fee of
          about 18%. Pool C quotes 998.2 and honours it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card border-bad/50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-bad">Unprotected router (trusts the best quote)</p>
            <p className="mono mt-2 text-4xl font-extrabold text-bad" data-testid="raw-number">
              819.2
            </p>
            <p className="mt-1 text-sm text-mute">tUSDC received. About 180 lost to a fee nobody quoted.</p>
          </div>
          <div className="card border-ok/50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-ok">FIRM (checks the fill against the quote)</p>
            <p className="mono mt-2 text-4xl font-extrabold text-ok" data-testid="firm-number">
              998.2
            </p>
            <p className="mt-1 text-sm text-mute">tUSDC received. Pool B rejected and struck, Pool C filled, all in one transaction.</p>
          </div>
        </div>
        <p className="max-w-3xl text-xs text-mute">
          Measured on a local fork of Monad Testnet with our own fixture hooks (Pool B is a test hook we wrote to behave this way): 819.179... and
          998.199... before rounding to one decimal. It has not been re-run on the public testnet yet, and it shows the mechanism works, not that
          real third-party hooks are caught.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="evidence">
        <h2 id="evidence" className="text-xl font-bold">
          Why this matters
        </h2>
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
            , 14 September 2026. This is 0x&apos;s classification, not ours. Uniswap&apos;s founder disputes the framing, noting that the count
            includes hooks with little activity (via Crypto Briefing).
          </footer>
        </blockquote>
        <p className="max-w-3xl text-sm text-mute">
          0x also describes hooks that price a swap one way in a quote request and another at settlement. A router that only ranks pools by quote
          cannot see that. FIRM can, because it asks the pool&apos;s quoter and then executes at the identical state, in one transaction.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="how">
        <h2 id="how" className="text-xl font-bold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ["Quote, then fill", "For each candidate pool FirmRouter asks the V4 Quoter inside the transaction, then swaps at the same state."],
            ["Reject and strike", "If the real output is below the pool's own quote (within a small tolerance), only that leg is undone, the shortfall is a public strike on the Scoreboard, and the next pool is tried."],
            ["Probe the rest", "A canary agent sends dust swaps from rotating sender addresses to catch hooks that are honest only to routers they recognise."],
          ].map(([h, p], i) => (
            <li key={h} className="card p-4">
              <p className="mono text-xs text-mute">{i + 1}</p>
              <p className="mt-1 font-semibold">{h}</p>
              <p className="mt-1 text-sm text-mute">{p}</p>
            </li>
          ))}
        </ol>
        <Link href="/swap?demo=1" className="btn btn-primary mt-2 no-underline">
          Try the demo
        </Link>
      </section>
    </div>
  );
}
