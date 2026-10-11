"use client";

import Link from "next/link";
import { deployments } from "@/lib/deployments";
import { DEMO_VILLAINS } from "@/lib/demo";
import { useBoard } from "@/hooks/useBoard";
import { SourceBadge } from "./SourceBadge";
import { ErrorState, Loading, NotDeployed } from "./States";
import { StatusChip } from "./StatusChip";

/** The correct order to show FIRM to a judge, with the live state that decides which cheat to try. */
export function JudgeFlow() {
  if (!deployments) return <NotDeployed />;
  return <Inner />;
}

function Inner() {
  const board = useBoard();
  const rows = board.data?.rows ?? [];
  const villainRows = Object.keys(DEMO_VILLAINS).map((n) => ({ n, row: rows.find((r) => r.pool === n) }));
  const fresh = villainRows.filter((v) => v.row && v.row.status !== "BLOCKED").map((v) => v.n);
  const next = fresh[0];

  const steps: { n: number; title: string; time: string; body: React.ReactNode; cta?: { href: string; label: string; testid: string } }[] = [
    {
      n: 1,
      title: "The problem",
      time: "20 s",
      body: "A quote comes from a simulation. A Uniswap v4 hook can behave differently in the real swap, and no router remembers which hooks did. 0x flagged 54.2% of v4 hooks as malicious (disputed).",
      cta: { href: "/#problem", label: "Open the problem", testid: "step-problem" },
    },
    {
      n: 2,
      title: "Get ready (once)",
      time: "1 min",
      body: (
        <>
          Connect a browser wallet on <strong>Monad Testnet</strong> (the button switches the network for you), take MON from the faucet in the yellow banner, then press{" "}
          <strong>Mint test tokens</strong>. All tokens are test tokens.
        </>
      ),
    },
    {
      n: 3,
      title: "See the loss: the unprotected router",
      time: "20 s",
      body: "Same trade, naive router, pointed at the cheating Pool B. Approve, swap, and read the result: the quote said 999, you receive about 819.",
      cta: { href: "/swap?demo=1&mode=raw", label: "Run the raw swap", testid: "step-raw" },
    },
    {
      n: 4,
      title: "See the protection: FIRM",
      time: "30 s",
      body: (
        <>
          Same trade through FirmRouter with a cheat ranked first.{" "}
          {next ? (
            <>
              Right now Pool <strong>{next}</strong> ({DEMO_VILLAINS[next]!.cheat}) has not been caught yet, so you can watch the router reject it live.
            </>
          ) : (
            <>Every cheat has already been caught. Choosing one still shows the router skipping it, which is what protects the next user; the first-encounter rejections are on the proof page.</>
          )}{" "}
          Read the timeline: skipped, rejected with the numbers, filled by an honest pool.
        </>
      ),
      cta: { href: `/swap?demo=1&mode=protected`, label: "Run the protected swap", testid: "step-protected" },
    },
    {
      n: 5,
      title: "The cheat is now public",
      time: "20 s",
      body: "The strike is on the Scoreboard for every router. The leaderboard (powered by Envio) shows the hook red; open it for its permissions, strike history and a plain-English summary.",
      cta: { href: "/leaderboard", label: "Open the leaderboard", testid: "step-board" },
    },
    {
      n: 6,
      title: "Check it yourself",
      time: "20 s",
      body: "Every number links to the block explorer: the two real transactions, the 14 verified contracts, the measured gas and what protection costs. It also lists what we did not run.",
      cta: { href: "/proof", label: "Open the proof", testid: "step-proof" },
    },
    {
      n: 7,
      title: "For routers and wallets",
      time: "10 s",
      body: "Adoption is two reads: statusOf(hook) and toleranceBps(hook). Code samples, addresses and ABIs are generated from the deployment file.",
      cta: { href: "/integrate", label: "Open integrate", testid: "step-integrate" },
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <ol className="space-y-4" data-testid="judge-steps">
        {steps.map((s) => (
          <li key={s.n} className="card p-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="mono text-xs text-mute">STEP {s.n}</span>
              <h2 className="text-lg font-bold">{s.title}</h2>
              <span className="text-xs text-mute">about {s.time}</span>
            </div>
            <p className="mt-1 text-sm text-mute">{s.body}</p>
            {s.cta ? (
              <Link href={s.cta.href} className="btn mt-3 no-underline" data-testid={s.cta.testid}>
                {s.cta.label}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>

      <aside className="space-y-4" aria-label="Live state">
        <section className="card p-4" data-testid="live-state">
          <h2 className="mb-2 text-lg font-bold">Live state of the cheats</h2>
          {board.isLoading ? (
            <Loading what="Reading the Scoreboard" />
          ) : board.isError ? (
            <ErrorState title="Could not read the Scoreboard" error={board.error} />
          ) : (
            <ul className="space-y-3">
              {villainRows.map(({ n, row }) => (
                <li key={n} className="text-sm" data-pool={n}>
                  <div className="flex items-center gap-2">
                    <strong>Pool {n}</strong>
                    {row ? <StatusChip status={row.status} /> : null}
                    <span className="text-xs text-mute">{DEMO_VILLAINS[n]!.cheat}</span>
                  </div>
                  <p className="text-xs text-mute">
                    {row ? (row.status === "BLOCKED" ? "Already caught: the router now skips it." : "Not caught yet: a protected swap will reject and strike it.") : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {board.data ? <div className="mt-3"><SourceBadge board={board.data} /></div> : null}
        </section>

        <details className="card p-4" data-testid="presenter-script">
          <summary className="cursor-pointer font-semibold">Presenter script, 60 to 90 seconds</summary>
          <ol className="mt-3 space-y-2 text-sm text-mute">
            <li><span className="mono text-xs">0:00</span> Routers rank pools by their quote. Hooks can lie about it: 0x classed 54.2% of v4 hooks as malicious and 26.4% more as likely malicious.</li>
            <li><span className="mono text-xs">0:15</span> Same trade, naive router. The best quote said 999. We get 819: about 180 tokens gone.</li>
            <li><span className="mono text-xs">0:30</span> Now FIRM. It quotes, executes, sees the shortfall, reverts that leg and tries the next pool.</li>
            <li><span className="mono text-xs">0:45</span> We got 998.2. And the hook is now publicly red for every router, indexed by Envio within seconds.</li>
            <li><span className="mono text-xs">1:00</span> Everything is on Monad Testnet and verifiable: two real transactions, 14 verified contracts. Protection costs about 1.4x to 1.8x the gas, and we list what we do not catch.</li>
          </ol>
        </details>
      </aside>
    </div>
  );
}
