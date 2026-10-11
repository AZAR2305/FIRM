import { costMon, evidence, num, overhead } from "@/lib/evidence";

/**
 * The honest price of protection: Monad charges the gas LIMIT, so a protected swap costs more than a raw one even when nothing is wrong.
 * All numbers are eth_estimateGas on the public testnet, from the evidence file; MON = limit x gas price at the time it was measured.
 */
export function CostCard() {
  if (!evidence) return null;
  const price = evidence.chain.gasPriceWei;
  const ft = evidence.recorded.firstTouch;
  const rows = ["A", "C"].map((n) => {
    const first = ft.pools[n]!;
    const now = evidence!.gas.pools[n];
    return { n, first, nowRaw: num(now?.raw), nowProt: num(now?.protected) };
  });
  const hostile = num(evidence.gas.hostileFirst.protected);
  return (
    <section className="card p-5" aria-labelledby="cost-h" data-testid="cost-card">
      <h2 id="cost-h" className="text-lg font-bold">
        What protection costs
      </h2>
      <p className="mt-1 text-sm text-mute">
        Protection is not free: the router asks for a quote and checks the fill for every pool it tries, and Monad charges the gas <em>limit</em>. Measured with{" "}
        <span className="mono">eth_estimateGas</span> on the public Monad Testnet at {evidence.chain.gasPriceGwei} gwei:
      </p>
      <div className="table-wrap mt-3">
        <table className="t" data-testid="cost-table">
          <thead>
            <tr>
              <th scope="col">Pool (100 tUSD)</th>
              <th scope="col" className="text-right">Raw router</th>
              <th scope="col" className="text-right">Protected</th>
              <th scope="col" className="text-right">Extra per swap</th>
              <th scope="col" className="text-right">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n}>
                <td>
                  <strong>Pool {r.n}</strong> <span className="text-xs text-mute">first swap through it</span>
                </td>
                <td className="mono text-right">{r.first.raw.toLocaleString("en-US")} gas<div className="text-xs text-mute">{costMon(r.first.raw, price)} MON</div></td>
                <td className="mono text-right">{r.first.protected.toLocaleString("en-US")} gas<div className="text-xs text-mute">{costMon(r.first.protected, price)} MON</div></td>
                <td className="mono text-right">{costMon(r.first.protected - r.first.raw, price)} MON</td>
                <td className="mono text-right">{overhead(r.first.raw, r.first.protected)}x</td>
              </tr>
            ))}
            {rows.map((r) =>
              r.nowRaw && r.nowProt && (r.nowRaw !== r.first.raw || r.nowProt !== r.first.protected) ? (
                <tr key={`${r.n}-now`} className="text-mute">
                  <td>
                    <strong>Pool {r.n}</strong> <span className="text-xs">later swaps (storage already exists)</span>
                  </td>
                  <td className="mono text-right">{r.nowRaw.toLocaleString("en-US")} gas<div className="text-xs">{costMon(r.nowRaw, price)} MON</div></td>
                  <td className="mono text-right">{r.nowProt.toLocaleString("en-US")} gas<div className="text-xs">{costMon(r.nowProt, price)} MON</div></td>
                  <td className="mono text-right">{costMon(r.nowProt - r.nowRaw, price)} MON</td>
                  <td className="mono text-right">{overhead(r.nowRaw, r.nowProt)}x</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mute">
        {hostile ? (
          <li>
            Meeting a cheat that burns gas costs more, once: <strong className="text-ink">{hostile.toLocaleString("en-US")} gas ({costMon(hostile, price)} MON)</strong>. The hook is then
            BLOCKED and skipped for everyone.
          </li>
        ) : null}
        <li>These are testnet MON. We do not convert them to dollars. The comparison that matters is the ratio, and it is against losing about 18% of a trade to a hidden fee.</li>
        <li>
          Monad receipts report gas used equal to the limit, so real usage cannot be read from a receipt; this is why we measure with estimates. Measured on{" "}
          {new Date(evidence.generatedAt).toISOString().slice(0, 10)}.
        </li>
      </ul>
    </section>
  );
}
