/**
 * Where the problem happens, in one picture: the same swap takes two different paths inside one transaction, and a hook can tell them apart
 * (it sees a different caller, or a different gas price). Routers rank pools by the first path and you get the second.
 */
export function LieDiagram() {
  const box = "rounded-lg border border-line bg-panel2 px-3 py-2 text-sm";
  return (
    <figure className="card p-5" data-testid="lie-diagram" aria-labelledby="lie-caption">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ok">1. The quote (what your router sees)</p>
          <ol className="space-y-2">
            <li className={box}>Router asks the pool&apos;s Quoter: &ldquo;what would I get for 1,000?&rdquo;</li>
            <li className={box}>
              The pool&apos;s <strong>hook</strong> runs and sees <span className="mono">caller = Quoter</span>
            </li>
            <li className={`${box} border-ok/60`}>
              It behaves honestly. Quote: <strong className="text-ok">999.0</strong>
            </li>
          </ol>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-bad">2. The execution (what you actually get)</p>
          <ol className="space-y-2">
            <li className={box}>Router swaps for real in the same pool</li>
            <li className={box}>
              The same <strong>hook</strong> runs and sees <span className="mono">caller = Router</span>
            </li>
            <li className={`${box} border-bad/60`}>
              It takes a hidden fee. You receive <strong className="text-bad">819.2</strong>
            </li>
          </ol>
        </div>
      </div>
      <figcaption id="lie-caption" className="mt-4 text-sm text-mute">
        A hook is code that runs inside the swap and can change the amounts. Nothing forces it to act the same way on both paths, and no router remembers which
        hooks did not. FIRM runs both paths in one transaction, at the same state, and compares them: any difference was caused by the hook, not by the market.
      </figcaption>
    </figure>
  );
}
