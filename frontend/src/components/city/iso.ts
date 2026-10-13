/**
 * Tiny isometric projection for the landing-page city. Grid units are tiles; the screen x of a point is (x - y) * HALF_W and its y is
 * (x + y) * HALF_H - z. Everything is original vector art generated from data.
 */
export const HALF_W = 56;
export const HALF_H = 28;

export type Pt = [number, number];

export function project(x: number, y: number, z: number, ox: number, oy: number): Pt {
  return [ox + (x - y) * HALF_W, oy + (x + y) * HALF_H - z];
}

export const pts = (list: Pt[]): string => list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");

/** darken (f < 1) or lighten (f > 1) a #rrggbb colour */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  color: string;
  /** z of the base, for stacked boxes */
  z?: number;
  /** 0 = ground (slabs, roads, plazas), painted first; 1 = things standing on it (default), painted back to front */
  layer?: 0 | 1;
}

/** The three visible faces of a box, as SVG polygon point lists, plus a painter's-order depth key (draw ascending). */
export function boxFaces(b: Box, ox: number, oy: number) {
  const z0 = b.z ?? 0;
  const z1 = z0 + b.h;
  const p = (x: number, y: number, z: number) => project(x, y, z, ox, oy);
  return {
    top: pts([p(b.x, b.y, z1), p(b.x + b.w, b.y, z1), p(b.x + b.w, b.y + b.d, z1), p(b.x, b.y + b.d, z1)]),
    left: pts([p(b.x, b.y + b.d, z1), p(b.x + b.w, b.y + b.d, z1), p(b.x + b.w, b.y + b.d, z0), p(b.x, b.y + b.d, z0)]),
    right: pts([p(b.x + b.w, b.y, z1), p(b.x + b.w, b.y + b.d, z1), p(b.x + b.w, b.y + b.d, z0), p(b.x + b.w, b.y, z0)]),
    depth: (b.layer ?? 1) * 1000 + b.x + b.w + b.y + b.d + z0 / 100,
    topColor: b.color,
    leftColor: shade(b.color, 0.86),
    rightColor: shade(b.color, 0.72),
  };
}
