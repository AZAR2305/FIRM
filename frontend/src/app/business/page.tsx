import Link from "next/link";
import { evidence, headline } from "@/lib/evidence";
import { fmt, pct } from "@/lib/format";

export const metadata = { title: "Business | FIRM", description: "Who loses money to a lying quote, who would pay to stop it, and what we have and have not validated." };

const PATHS = [
  {
    path: "Integrator fee on routed volume",
    payer: "Wallets and aggregators that route through FirmRouter",
    gets: "Swaps that deliver their quote or fall back, with no support burden from silent shortfalls",
    status: "Proposed. FirmRouter charges no fee today; adding one is a contract change we have not made.",
  },
  {
    path: "Hosted scoreboard feed with alerts",
    payer: "Routers, wallets and agent platforms",
    gets: "The same public on-chain ledger, delivered as an indexed API with webhooks and uptime commitments. The on-chain data itself stays free to read.",
    status: "Proposed. We run an Envio index for our own screens; there is no paid service or SLA.",
  },
  {
    path: "Continuous monitoring for hook teams",
    payer: "Honest hook builders and liquidity providers",
    gets: "Canary probing from many senders and a public track record. They would pay for monitoring, never for a rating: status stays computed by the contracts and cannot be bought.",
    status: "Proposed. The canary exists as a contract and agent; there is no customer-facing product.",
  },
  {
    path: "Safe-swap tool for AI agents",
    payer: "Agent platforms that let a model trade",
    gets: "One swap tool (MCP) whose only path goes through the check, so a confused agent cannot skip it",
    status: "Built as a tool server and tested with a real model in a small smoke test. No paying user.",
  },
];

export default function BusinessPage() {
  const h = headline(evidence);
  return (
    <div className="space-y-24">
      <div className="page-head">
        <h1 className="page-title">The business case</h1>
        <p className="page-lead">
          Who loses money when a quote lies, who would pay to stop it, and an honest line between what exists today and what is only a proposal. We have no customers and have not tested any price.
        </p>
      </div>

      <section className="space-y-6" aria-labelledby="cost">
        <div className="section-head !mb-0">
          <p className="eyebrow">The cost today</p>
          <h2 id="cost" className="section-title">A quote that lies is a silent fee</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <div className="card space-y-2 p-7">
            <p className="mono text-4xl font-bold text-bad">{h ? pct(BigInt(h.shortfallBps)) : "n/a"}</p>
            <p className="copy">
              {h ? `Taken by one of our test hooks on a real Monad Testnet trade of ${fmt(h.amountIn, 0)} tUSD: ${fmt(h.rawOut, 1)} delivered against ${fmt(h.quoted, 1)} quoted.` : "No evidence file was generated for this build."}
            </p>
          </div>
          <div className="card space-y-2 p-7">
            <p className="mono text-4xl font-bold text-bad">99 bps</p>
            <p className="copy">Lost by a real language-model agent that took the best quote, twice in a row, in our small testnet smoke test (docs/BOUNTIES.md). Two trades, not a benchmark.</p>
          </div>
          <div className="card space-y-2 p-7">
            <p className="mono text-4xl font-bold">54.2%</p>
            <p className="copy">
              of 84,163 analysed v4 hooks classed malicious by 0x (11 Sep 2026), with 26.4% more likely malicious. That is 0x&apos;s classification, disputed by Uniswap&apos;s founder, and we make no estimate of real losses.
            </p>
          </div>
        </div>
        <p className="copy max-w-3xl">
          The loss scales with the trade: a hook that takes a percentage takes it on a 10 tUSD swap and on a 10,000 tUSD swap alike. FIRM works for any amount the pools can fill. At 100,000 tUSD two of
          our four pools could not quote at all for lack of liquidity, which is a limit of our small seeded pools, not of the check.
        </p>
      </section>

      <section className="space-y-6" aria-labelledby="paths">
        <div className="section-head !mb-0">
          <p className="eyebrow">How it could earn</p>
          <h2 id="paths" className="section-title">Four paths, none of them live</h2>
        </div>
        <div className="card table-wrap">
          <table className="t" data-testid="revenue-paths">
            <caption className="sr-only">Possible revenue paths and their status</caption>
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Who pays</th>
                <th scope="col">What they get</th>
                <th scope="col">Status today</th>
              </tr>
            </thead>
            <tbody>
              {PATHS.map((p) => (
                <tr key={p.path}>
                  <td className="font-semibold">{p.path}</td>
                  <td className="text-mute">{p.payer}</td>
                  <td className="text-mute">{p.gets}</td>
                  <td className="text-mute">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-12 lg:grid-cols-2" aria-labelledby="why">
        <div className="space-y-4">
          <p className="eyebrow">Why it can compound</p>
          <h2 id="why" className="section-title">The scoreboard gets more useful with every router</h2>
          <p className="copy">
            A strike recorded by one router protects every other router that reads the Scoreboard. Adopting it takes two read calls, so the cost of a first integration is small, and every
            integrator makes the ledger more valuable to the next. That network effect only holds if the ratings stay trustworthy, which is why status is computed by contracts and not by us.
          </p>
        </div>
        <div className="space-y-4">
          <p className="eyebrow">What we have not validated</p>
          <h2 className="section-title">The honest gaps</h2>
          <ul className="copy list-disc space-y-2 pl-5">
            <li>No customer has used it and no price has been tested.</li>
            <li>We have not caught a real third-party malicious hook; our cheats are our own fixtures.</li>
            <li>Protection costs more gas (1.44x to 1.77x the limit of an unprotected swap on Monad, measured), and a buyer must decide that is worth it.</li>
            <li>One owner key controls the Scoreboard. A paid service would need a multisig and a timelock first.</li>
          </ul>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href="/agent" className="btn btn-primary no-underline">Try the agent</Link>
        <Link href="/proof" className="btn no-underline">See the proof</Link>
      </div>
    </div>
  );
}
