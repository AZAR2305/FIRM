"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { boxFaces, project, pts, type Box } from "./iso";

const OX = 430;
const OY = 150;
const VIEW_W = 1400;
const VIEW_H = 700;

interface District {
  id: string;
  label: string;
  title: string;
  text: string;
  /** where the sign hangs (grid x, y, z) */
  at: [number, number, number];
  dot: string;
}

/** What each district stands for. Plain statements about the project; nothing here claims a partnership or a measured result. */
export const DISTRICTS: District[] = [
  {
    id: "uniswap",
    label: "Uniswap v4 Quarter",
    title: "Where pools live, and where hooks attach",
    text: "In Uniswap v4 every pool can attach a hook: code that runs inside the swap and can change what it delivers. FIRM builds on the v4 PoolManager and Quoter that Monad maintains on its testnet (not official Uniswap deployments). FIRM is not affiliated with Uniswap Labs.",
    at: [2.2, 0.5, 130],
    dot: "#a8608f",
  },
  {
    id: "quote",
    label: "Quote Street",
    title: "Where the quote is made",
    text: "A router asks the pool's Quoter 'what would I get for 1,000?'. That answer comes from a simulation, and routers rank pools by it. FIRM asks the Quoter inside the swap transaction and executes at the same state, so the two can be compared.",
    at: [3.7, 2.55, 30],
    dot: "#2f66bd",
  },
  {
    id: "tower",
    label: "Scoreboard Tower",
    title: "A public record of who kept their word",
    text: "An on-chain ledger of hook honesty. Any router can read statusOf(hook) and toleranceBps(hook) before routing, with no permission and no API key. A hook that delivers less than it quoted is struck, and a severe or repeated strike BLOCKS it for everyone.",
    at: [6.2, 1.2, 215],
    dot: "#c0392b",
  },
  {
    id: "hooks",
    label: "Hook Hill",
    title: "Hooks: some keep their quote, some do not",
    text: "A hook sees who is calling. An honest one behaves the same for the Quoter and for the router. A cheating one can quote a good price to the Quoter and take a hidden fee in the real swap. The hooks on this hill are our own test fixtures.",
    at: [8.6, 1.1, 130],
    dot: "#1c7678",
  },
  {
    id: "alley",
    label: "Cheaters' Alley",
    title: "Our own cheats, built to be caught",
    text: "Test fixtures that misbehave on purpose: one takes a hidden 18% fee, one burns all its gas, one reverts. FIRM rejects the swap leg, records a strike, and moves on. They live only in contracts/test-fixtures. Catching them shows the mechanism works; it does not show that real malicious hooks are caught.",
    at: [8.6, 4.0, 150],
    dot: "#8e2b2b",
  },
  {
    id: "park",
    label: "Honest Park",
    title: "Where the router falls back",
    text: "Pools that deliver what they quoted. When a cheat is rejected, FirmRouter tries the next pool, so the trader still gets a fill. The proof page shows a real testnet trade where the honest pool filled after a cheat was rejected.",
    at: [1.0, 4.5, 60],
    dot: "#1b7f5c",
  },
  {
    id: "coop",
    label: "Canary Coop",
    title: "Probing before users arrive",
    text: "A canary sends dust swaps from several sender addresses, because a hook can be honest to the router and cheat other callers. Our router missed such a fixture 20 times out of 20; only the canary caught it. A hook that recognises the canary beats it: an arms race, not a solved problem.",
    at: [6.1, 4.3, 62],
    dot: "#d9a400",
  },
  {
    id: "harbour",
    label: "Monad Harbour",
    title: "Everything runs on Monad Testnet",
    text: "Deployed on Monad Testnet (chain 10143) with source-verified contracts. Fast blocks make a strike visible within a block or two, and cheap block space makes a quote and a check for every pool affordable. Monad charges the gas limit, so protection is not free: the cost card on this page shows what we measured.",
    at: [12.5, 1.3, 150],
    dot: "#6b3fd4",
  },
  {
    id: "observatory",
    label: "Envio Observatory",
    title: "Reading the chain through HyperSync",
    text: "Envio HyperIndex reads Monad Testnet through HyperSync and powers the leaderboard, the live activity feed and every hook page. The page says which source answered and how far behind the chain the index is. Contracts never read it.",
    at: [13.3, 3.9, 130],
    dot: "#403650",
  },
];

const boxes: Box[] = [];
const add = (b: Box) => boxes.push(b);

// ---- Uniswap v4 Quarter: a raised platform, a tall PoolManager, small pools
add({ x: 0.4, y: 0.3, w: 3.9, d: 1.7, h: 10, color: "#ead0e0", layer: 0 });
add({ x: 0.9, y: 0.7, w: 1.2, d: 1.0, h: 90, z: 10, color: "#a8608f" });
add({ x: 0.9, y: 0.7, w: 1.2, d: 1.0, h: 6, z: 100, color: "#7d3f69" });
add({ x: 2.5, y: 0.6, w: 0.8, d: 0.8, h: 40, z: 10, color: "#1c7678" });
add({ x: 3.3, y: 1.1, w: 0.7, d: 0.7, h: 30, z: 10, color: "#2e8f6b" });
add({ x: 2.7, y: 1.5, w: 0.6, d: 0.4, h: 18, z: 10, color: "#2f66bd" });

// ---- roads: Quote Street along y, a cross street along x
add({ x: 0, y: 2.25, w: 10.4, d: 0.6, h: 3, color: "#e4cdb6", layer: 0 });
add({ x: 4.75, y: 0, w: 0.6, d: 5.0, h: 3, color: "#e4cdb6", layer: 0 });
// a few "quote" signs on the street: small blue stalls
add({ x: 1.1, y: 2.3, w: 0.35, d: 0.35, h: 14, z: 3, color: "#2f66bd" });
add({ x: 3.1, y: 2.3, w: 0.35, d: 0.35, h: 14, z: 3, color: "#2f66bd" });

// ---- Scoreboard Tower: tall, banded, with a red flag on top
add({ x: 5.9, y: 0.7, w: 1.2, d: 1.2, h: 70, color: "#403650" });
add({ x: 6.0, y: 0.8, w: 1.0, d: 1.0, h: 60, z: 70, color: "#5a4d70" });
add({ x: 6.15, y: 0.95, w: 0.7, d: 0.7, h: 40, z: 130, color: "#403650" });
add({ x: 6.4, y: 1.2, w: 0.2, d: 0.2, h: 38, z: 170, color: "#2b2340" });
add({ x: 6.4, y: 1.0, w: 0.2, d: 0.5, h: 14, z: 194, color: "#c0392b" });

// ---- Hook Hill: a plateau with an honest hook and the cheating Pool B
add({ x: 7.3, y: 0.3, w: 2.9, d: 1.7, h: 18, color: "#f3e0c8", layer: 0 });
add({ x: 7.7, y: 0.7, w: 0.9, d: 0.9, h: 62, z: 18, color: "#1c7678" });
add({ x: 9.0, y: 0.7, w: 0.9, d: 0.9, h: 80, z: 18, color: "#c0392b" });
add({ x: 9.25, y: 0.95, w: 0.4, d: 0.4, h: 10, z: 98, color: "#ffd9d4" });

// ---- Cheaters' Alley: dark, narrow, with a billboard
add({ x: 7.2, y: 3.0, w: 3.0, d: 1.8, h: 6, color: "#d9c2ad", layer: 0 });
add({ x: 7.5, y: 3.3, w: 0.8, d: 0.8, h: 92, z: 6, color: "#8e2b2b" });
add({ x: 8.6, y: 3.6, w: 0.8, d: 0.8, h: 54, z: 6, color: "#5c3a4a" });
add({ x: 9.5, y: 3.3, w: 0.5, d: 0.5, h: 36, z: 6, color: "#7a2f2f" });
add({ x: 8.4, y: 3.1, w: 1.4, d: 0.15, h: 22, z: 62, color: "#2b2340" });

// ---- Honest Park: green plaza, one honest pool, trees
add({ x: 0.4, y: 3.0, w: 3.9, d: 1.9, h: 5, color: "#bfe3c8", layer: 0 });
add({ x: 2.3, y: 3.5, w: 1.0, d: 1.0, h: 54, z: 5, color: "#2e8f6b" });
for (const [tx, ty] of [[0.8, 3.4], [1.5, 4.2], [0.9, 4.4], [3.7, 3.4], [3.8, 4.4], [1.7, 3.3]] as const) {
  add({ x: tx, y: ty, w: 0.14, d: 0.14, h: 16, z: 5, color: "#7a5a3a" });
}

// ---- Canary Coop: a small yellow house
add({ x: 5.85, y: 3.35, w: 0.9, d: 0.9, h: 34, color: "#f5c542" });
add({ x: 5.95, y: 3.45, w: 0.7, d: 0.7, h: 8, z: 34, color: "#d9a400" });

// ---- Monad Harbour: a pier with stacked "block" containers
add({ x: 10.4, y: 0.2, w: 0.5, d: 4.7, h: 4, color: "#c9a97d", layer: 0 });
const stackColors = ["#6b3fd4", "#8b66e6", "#5530b0", "#a58af0"];
for (let r = 0; r < 3; r++) {
  for (let s = 0; s < 3; s++) {
    for (let k = 0; k <= (r + s) % 3; k++) {
      add({ x: 11.1 + s * 0.85, y: 0.5 + r * 0.9, w: 0.7, d: 0.7, h: 20, z: 6 + k * 20, color: stackColors[(r * 3 + s + k) % stackColors.length]! });
    }
  }
}

// ---- Envio Observatory: an island with a dome
add({ x: 12.4, y: 3.2, w: 2.0, d: 1.7, h: 9, color: "#e9d8bf", layer: 0 });
add({ x: 12.9, y: 3.6, w: 0.9, d: 0.9, h: 60, z: 9, color: "#403650" });

const drawn = boxes.map((b) => boxFaces(b, OX, OY)).sort((a, b) => a.depth - b.depth);
const land = boxFaces({ x: -0.3, y: -0.3, w: 10.7, d: 5.6, h: 14, color: "#fdebd7" }, OX, OY);
const water = boxFaces({ x: 10.4, y: -0.3, w: 5.0, d: 5.6, h: 6, color: "#bcd8f3" }, OX, OY);

function Sign({ d, active, onSelect }: { d: District; active: boolean; onSelect: (id: string) => void }) {
  const [sx, sy] = project(d.at[0], d.at[1], d.at[2], OX, OY);
  const width = d.label.length * 7.4 + 34;
  const key = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(d.id);
    }
  };
  return (
    <g className="district" role="button" tabIndex={0} aria-label={`${d.label}: ${d.title}`} aria-pressed={active} onClick={() => onSelect(d.id)} onKeyDown={key} data-district={d.id}>
      <g className="district-sign">
        <line x1={sx} y1={sy + 14} x2={sx} y2={sy + 34} stroke="#2b2340" strokeWidth={2} />
        <rect x={sx - width / 2} y={sy - 14} width={width} height={28} rx={14} fill={active ? "#2b2340" : "#ffffff"} stroke="#2b2340" strokeWidth={2} />
        <circle cx={sx - width / 2 + 14} cy={sy} r={6} fill={d.dot} />
        <text x={sx - width / 2 + 26} y={sy + 4.5} fontSize={13} fontWeight={700} fill={active ? "#ffffff" : "#2b2340"} fontFamily="ui-rounded, 'Segoe UI', system-ui, sans-serif">
          {d.label}
        </text>
      </g>
    </g>
  );
}

/**
 * "FIRM City": an original isometric illustration of the project, one district per idea. Drag to pan on small screens, click (or press Enter on) a
 * sign to read what the district stands for. The text under the map is plain HTML so it is readable without the picture.
 */
export function CityMap() {
  const [active, setActive] = useState<string>("quote");
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const info = DISTRICTS.find((d) => d.id === active)!;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const v = viewport.current;
    if (!v) return;
    drag.current = { x: e.clientX, left: v.scrollLeft, moved: false };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const v = viewport.current;
    const d = drag.current;
    if (!v || !d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    v.scrollLeft = d.left - dx;
  };
  const up = () => {
    drag.current = null;
  };

  return (
    <div data-testid="city-map" className="space-y-3">
      <div
        ref={viewport}
        className="city-viewport card overflow-x-auto overflow-y-hidden"
        style={{ background: "linear-gradient(#fff3e3, #ffe9d0)" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="group"
          aria-label="Illustration: FIRM City, one district per part of the project. Each sign is a button; the descriptions are also listed below the picture."
          style={{ width: "max(1100px, 100%)", height: "auto", display: "block" }}
        >
          <polygon points={land.top} fill={land.topColor} />
          <polygon points={land.left} fill={land.leftColor} />
          <polygon points={land.right} fill={land.rightColor} />
          <polygon points={water.top} fill={water.topColor} />
          <polygon points={water.left} fill={water.leftColor} />
          <polygon points={water.right} fill={water.rightColor} />
          {/* ripples */}
          {[0, 1, 2, 3, 4].map((i) => {
            const [a, b] = project(11.2 + (i % 2) * 1.6, 1.6 + i * 0.7, 6, OX, OY);
            return <path key={i} d={`M${a - 18},${b} q9,-6 18,0 t18,0`} stroke="#ffffff" strokeWidth={2} fill="none" opacity={0.8} />;
          })}
          {drawn.map((f, i) => (
            <g key={i}>
              <polygon points={f.left} fill={f.leftColor} />
              <polygon points={f.right} fill={f.rightColor} />
              <polygon points={f.top} fill={f.topColor} />
            </g>
          ))}
          {/* tree canopies, the observatory dome, the "$" on the cheating pool, the canary */}
          {[[0.87, 3.47], [1.57, 4.27], [0.97, 4.47], [3.77, 3.47], [3.87, 4.47], [1.77, 3.37]].map(([x, y], i) => {
            const [a, b] = project(x!, y!, 33, OX, OY);
            return <circle key={i} cx={a} cy={b} r={17} fill={i % 2 ? "#3aa876" : "#2e8f6b"} />;
          })}
          {(() => {
            const [a, b] = project(13.35, 4.05, 69, OX, OY);
            return (
              <g>
                <ellipse cx={a} cy={b} rx={36} ry={20} fill="#5a4d70" />
                <line x1={a} y1={b - 20} x2={a} y2={b - 42} stroke="#2b2340" strokeWidth={3} />
                <circle cx={a} cy={b - 44} r={5} fill="#d9a400" />
              </g>
            );
          })()}
          {(() => {
            const [a, b] = project(9.45, 1.15, 112, OX, OY);
            return (
              <text x={a} y={b} fontSize={22} fontWeight={800} textAnchor="middle" fill="#ffffff" fontFamily="ui-rounded, 'Segoe UI', system-ui, sans-serif">
                -18%
              </text>
            );
          })()}
          {(() => {
            const [a, b] = project(6.3, 3.8, 50, OX, OY);
            return <ellipse cx={a} cy={b} rx={7} ry={6} fill="#fff1b8" stroke="#8a6d00" strokeWidth={2} />;
          })()}
          {/* a swap path: quote goes down the street, the fill comes back from the honest pool */}
          {(() => {
            const a = project(0.3, 2.55, 6, OX, OY);
            const b = project(9.9, 2.55, 6, OX, OY);
            return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#2f66bd" strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" />;
          })()}
          <polygon points={pts([project(4.75, 0, 4, OX, OY), project(5.35, 0, 4, OX, OY), project(5.35, 5, 4, OX, OY), project(4.75, 5, 4, OX, OY)])} fill="none" />
          {DISTRICTS.map((d) => (
            <Sign key={d.id} d={d} active={d.id === active} onSelect={setActive} />
          ))}
        </svg>
      </div>
      <p className="text-center text-xs text-mute">Drag to explore. Select a sign to read what it stands for.</p>
      <div className="card p-5" aria-live="polite" data-testid="district-info">
        <p className="text-xs font-bold uppercase tracking-wide text-mute">{info.label}</p>
        <h3 className="mt-1 text-lg font-bold">{info.title}</h3>
        <p className="mt-1 text-sm text-mute">{info.text}</p>
      </div>
      <ul className="flex flex-wrap justify-center gap-2" aria-label="Districts">
        {DISTRICTS.map((d) => (
          <li key={d.id}>
            <button type="button" className="pill" aria-pressed={d.id === active} onClick={() => setActive(d.id)} data-testid={`district-${d.id}`}>
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: d.dot }} />
              {d.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
