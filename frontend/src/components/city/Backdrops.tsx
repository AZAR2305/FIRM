/**
 * Decorative backgrounds for the "why Uniswap" and "why Monad" sections. Original vector art: a liquidity-curve motif for Uniswap v4 (pools,
 * ticks, a hook gate) and a stack of blocks for Monad. Purely decorative (aria-hidden); no logos or trademarks are reproduced.
 */
export function UniswapBackdrop() {
  const bars = Array.from({ length: 28 }, (_, i) => {
    const x = 20 + i * 28;
    const t = (i - 13.5) / 9;
    const h = 30 + 130 * Math.exp(-t * t);
    return { x, h };
  });
  return (
    <svg aria-hidden viewBox="0 0 820 300" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="uniFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8608f" stopOpacity="0.28" />
          <stop offset="1" stopColor="#a8608f" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {/* liquidity bars across price ticks */}
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={290 - b.h} width={22} height={b.h} rx={5} fill="url(#uniFade)" />
      ))}
      {/* the constant-product curve */}
      <path d="M20,40 C140,60 230,150 410,200 S720,262 800,270" fill="none" stroke="#a8608f" strokeOpacity="0.45" strokeWidth="3" strokeDasharray="3 9" strokeLinecap="round" />
      {/* a hook gate over the curve */}
      <g stroke="#403650" strokeOpacity="0.35" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M560,208 v-70 a34,34 0 0 1 68,0 v70" />
        <path d="M594,104 v-20" />
        <circle cx="594" cy="76" r="9" fill="#fce4cc" />
      </g>
    </svg>
  );
}

export function MonadBackdrop() {
  const cols = 9;
  const rows = 5;
  const colors = ["#6b3fd4", "#8b66e6", "#5530b0", "#a58af0"];
  const cells: { x: number; y: number; c: string; o: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r * 7 + c * 3) % 5 === 0) continue;
      cells.push({ x: 40 + c * 84, y: 30 + r * 52, c: colors[(r + c) % colors.length]!, o: 0.1 + ((r * 5 + c * 3) % 6) * 0.045 });
    }
  }
  return (
    <svg aria-hidden viewBox="0 0 820 300" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
      {cells.map((k, i) => (
        <rect key={i} x={k.x} y={k.y} width={72} height={40} rx={9} fill={k.c} opacity={k.o} />
      ))}
      {/* a chain of blocks, each one linked to the last */}
      <g stroke="#403650" strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <rect x={60 + i * 120} y={236} width={84} height={44} rx={10} fill="#fff9f2" fillOpacity="0.9" />
            {i < 5 ? <line x1={144 + i * 120} y1={258} x2={180 + i * 120} y2={258} /> : null}
          </g>
        ))}
      </g>
    </svg>
  );
}
