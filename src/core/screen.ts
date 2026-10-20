// Screen-space reasoning for "what you see is real" physics (GAME_PLAN §4.9).
// For view k: `depth` grows toward the camera; (sx, sy) are screen coordinates in world units.
import { VIEWS } from './grid';
import { type Segment, depthOf, frameAt, lengthOf } from './track';

type P = readonly [number, number, number];

interface Basis { u: P; r: P; up: P }

const norm = (a: P): P => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const crossP = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P, b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const BASES: Basis[] = VIEWS.map((v) => {
  const u = norm(v);
  const r = norm(crossP([0, 1, 0], u));
  return { u, r, up: crossP(u, r) };
});

export interface ScreenPoint { sx: number; sy: number; depth: number }

export function toScreen(p: readonly number[], view: number): ScreenPoint {
  const b = BASES[view];
  return { sx: dot(b.r, p), sy: dot(b.up, p), depth: dot(b.u, p) };
}

/**
 * What a solid looks like on screen: points across its whole slab cross-section
 * (riding surface down to the base, edge to edge), sampled along its length.
 */
/** Cross-section sample depths: just under the surface, mid-slab, and the slab's base. */
const footN = (seg: Segment) => { const d = depthOf(seg); return [-0.3, -0.28 - d / 2, -0.28 - d + 0.02]; };
const FOOT_W = [-0.38, 0, 0.38];
const cache = new Map<string, number[][]>();

export function footprint(seg: Segment): number[][] {
  const k = `${seg.kind}|${seg.from}|${seg.to}|${seg.t0}|${seg.n0}|${depthOf(seg)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const len = lengthOf(seg);
  const steps = Math.max(2, Math.ceil(len / 0.25));
  const out: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = frameAt(seg, 1, (len * i) / steps);
    const w = crossP(f.t, f.n);
    for (const a of footN(seg)) for (const c of FOOT_W) {
      out.push([f.p[0] + f.n[0] * a + w[0] * c, f.p[1] + f.n[1] * a + w[1] * c, f.p[2] + f.n[2] * a + w[2] * c]);
    }
  }
  if (cache.size > 4000) cache.clear();
  cache.set(k, out);
  return out;
}

/** On screen, within this distance of a solid's footprint the ball is touching it. */
export const TOUCH = 0.34;
/** A solid must be at least this much nearer the camera than the ball to count as "in front". */
export const IN_FRONT = 0.7;

const screenCache = new Map<string, ScreenPoint[]>();

function footprintOnScreen(seg: Segment, view: number): ScreenPoint[] {
  const k = `${view}|${seg.kind}|${seg.from}|${seg.to}|${seg.t0}|${seg.n0}|${depthOf(seg)}`;
  let pts = screenCache.get(k);
  if (!pts) {
    pts = footprint(seg).map((q) => toScreen(q, view));
    if (screenCache.size > 4000) screenCache.clear();
    screenCache.set(k, pts);
  }
  return pts;
}

/** Is the ball at `p` hidden behind (so: running into) any of these solids? */
export function blockedAt(p: readonly number[], solids: readonly Segment[], view: number): Segment | null {
  const b = toScreen(p, view);
  for (const s of solids) {
    for (const sq of footprintOnScreen(s, view)) {
      if (sq.depth - b.depth < IN_FRONT) continue;
      if (Math.hypot(sq.sx - b.sx, sq.sy - b.sy) < TOUCH) return s;
    }
  }
  return null;
}
