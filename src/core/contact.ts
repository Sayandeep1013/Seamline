// What the ball can touch and what can hide it, tested against the exact triangles that are drawn
// (GAME_PLAN §4.4b). Two rules, both strict:
//   1. Solid: the ball's sphere never overlaps any slab in 3D (it may rest on a surface, no deeper).
//   2. Seen: no part of the ball as drawn is ever hidden by anything drawn in front of it.
// The game, the solver and the audit all use these, so what you see is exactly what the ball does.
import { VIEWS } from './grid';
import { type Segment, depthAlong, frameAt, lengthOf } from './track';

/** Ball radius and slab cross-section, shared with render/geometry.ts. */
export const BALL_R = 0.28;
export const BEAM_W = 0.9;
/** Straights reach past ends that nothing joins onto, so the ball sits on solid track there. */
export const END_EXT = { open: 0, cap: 0.5, start: 0.5, goal: 0.55, drop: 0 } as const;

/** Resting on a surface is touching it at exactly BALL_R; anything this much closer is overlapping. */
const SINK = 0.03;
/** A surface must cover the drawn ball by more than this in depth to count as hiding it. */
const HIDE = 0.01;

type P = [number, number, number];

export interface Shape {
  /** Triangles as flat xyz triples: body, then the two end faces (hidden while that end is joined). */
  body: Float64Array;
  caps: [Float64Array, Float64Array];
  min: P; max: P;
}

/** Cross-section frames along a segment (14 per arc), with straights extended past their capped ends. */
function frames(seg: Segment) {
  const len = lengthOf(seg);
  const steps = seg.kind === 'straight' ? 1 : 14;
  const out: { p: P; n: P; w: P; d: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = frameAt(seg, 1, (len * i) / steps);
    const t = f.t, n = f.n;
    const w: P = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    out.push({ p: [...f.p] as P, n: [...n] as P, w, d: depthAlong(seg, i / steps) });
  }
  if (seg.kind === 'straight') {
    const t = frameAt(seg, 1, 0).t;
    const e0 = END_EXT[seg.ends[0]], e1 = END_EXT[seg.ends[1]];
    for (let k = 0; k < 3; k++) { out[0].p[k] -= t[k] * e0; out[out.length - 1].p[k] += t[k] * e1; }
  }
  return out;
}

const cache = new Map<string, Shape>();
const shapeKey = (s: Segment) => `${s.kind}|${s.from}|${s.to}|${s.t0}|${s.n0}|${s.ends}|${s.depth ?? ''}|${s.starQuarter ?? ''}`;

/** The segment's slab as drawn: riding surface BALL_R under the ball path, then its depth, BEAM_W wide. */
export function shapeOf(seg: Segment): Shape {
  const k = shapeKey(seg);
  const hit = cache.get(k);
  if (hit) return hit;
  const F = frames(seg);
  const hw = BEAM_W / 2;
  const at = (f: (typeof F)[number], bottom: boolean, side: number): P => {
    const nv = bottom ? -BALL_R - f.d : -BALL_R;
    return [0, 1, 2].map((i) => f.p[i] + f.n[i] * nv + f.w[i] * side * hw) as P;
  };
  const body: number[] = [];
  const quad = (a: P, b: P, c: P, d: P, out: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < F.length - 1; i++) {
    const s = F[i], e = F[i + 1];
    quad(at(s, false, -1), at(e, false, -1), at(e, false, 1), at(s, false, 1), body);
    quad(at(s, true, -1), at(e, true, -1), at(e, true, 1), at(s, true, 1), body);
    quad(at(s, false, 1), at(e, false, 1), at(e, true, 1), at(s, true, 1), body);
    quad(at(s, false, -1), at(e, false, -1), at(e, true, -1), at(s, true, -1), body);
  }
  const cap = (f: (typeof F)[number]) => { const c: number[] = []; quad(at(f, false, -1), at(f, false, 1), at(f, true, 1), at(f, true, -1), c); return new Float64Array(c); };
  const caps: [Float64Array, Float64Array] = [cap(F[0]), cap(F[F.length - 1])];
  const min: P = [Infinity, Infinity, Infinity], max: P = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < body.length; i += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], body[i + a]); max[a] = Math.max(max[a], body[i + a]);
  }
  const shape = { body: new Float64Array(body), caps, min, max };
  if (cache.size > 4000) cache.clear();
  cache.set(k, shape);
  return shape;
}

/** Squared distance from point p to triangle (a, b, c) (Ericson, Real-Time Collision Detection 5.1.5). */
export function triDist2(p: P, t: Float64Array, o: number): number {
  const ax = t[o], ay = t[o + 1], az = t[o + 2];
  const abx = t[o + 3] - ax, aby = t[o + 4] - ay, abz = t[o + 5] - az;
  const acx = t[o + 6] - ax, acy = t[o + 7] - ay, acz = t[o + 8] - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  const set = (u: number, v: number) => { qx = ax + abx * u + acx * v; qy = ay + aby * u + acy * v; qz = az + abz * u + acz * v; };
  if (d1 <= 0 && d2 <= 0) set(0, 0);
  else {
    const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) set(1, 0);
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) set(d1 / (d1 - d3), 0);
    else if (d6 >= 0 && d5 <= d6) set(0, 1);
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) set(0, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); set(1 - w, w); }
    else { const den = 1 / (va + vb + vc); set(vb * den, vc * den); }
  }
  return (p[0] - qx!) ** 2 + (p[1] - qy!) ** 2 + (p[2] - qz!) ** 2;
}

/** Which caps are drawn: an end's face is hidden while something joins onto that end. */
export type CapsShown = (seg: Segment, end: 0 | 1) => boolean;

function* tris(seg: Segment, caps: CapsShown) {
  const s = shapeOf(seg);
  yield s.body;
  if (caps(seg, 0)) yield s.caps[0];
  if (caps(seg, 1)) yield s.caps[1];
}

/** The first segment the ball's sphere at `p` sinks into, if any. */
export function overlapping(p: readonly number[], segs: readonly Segment[], caps: CapsShown): Segment | null {
  const q = p as P, r = BALL_R - SINK, r2 = r * r;
  for (const seg of segs) {
    const s = shapeOf(seg);
    if (q[0] < s.min[0] - r || q[0] > s.max[0] + r || q[1] < s.min[1] - r || q[1] > s.max[1] + r || q[2] < s.min[2] - r || q[2] > s.max[2] + r) continue;
    for (const t of tris(seg, caps)) for (let o = 0; o < t.length; o += 9) if (triDist2(q, t, o) < r2) return seg;
  }
  return null;
}

// Screen basis per view: r (right), up, u (toward the camera).
const BASES = VIEWS.map((v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  const u: P = [v[0] / l, v[1] / l, v[2] / l];
  const rl = Math.hypot(u[2], u[0]);
  const r: P = [u[2] / rl, 0, -u[0] / rl];
  const up: P = [u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]];
  return { r, up, u };
});

export function toScreen(p: readonly number[], view: number): P {
  const b = BASES[view];
  return [
    b.r[0] * p[0] + b.r[1] * p[1] + b.r[2] * p[2],
    b.up[0] * p[0] + b.up[1] * p[1] + b.up[2] * p[2],
    b.u[0] * p[0] + b.u[1] * p[1] + b.u[2] * p[2],
  ];
}

const projCache = new Map<string, { tri: Float64Array; caps: [Float64Array, Float64Array]; min: [number, number]; max: [number, number] }>();

function projected(seg: Segment, view: number) {
  const k = `${view}|${shapeKey(seg)}`;
  let hit = projCache.get(k);
  if (hit) return hit;
  const s = shapeOf(seg);
  const proj = (t: Float64Array) => {
    const o = new Float64Array(t.length);
    for (let i = 0; i < t.length; i += 3) o.set(toScreen([t[i], t[i + 1], t[i + 2]], view), i);
    return o;
  };
  const tri = proj(s.body);
  const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3) for (let a = 0; a < 2; a++) { min[a] = Math.min(min[a], tri[i + a]); max[a] = Math.max(max[a], tri[i + a]); }
  hit = { tri, caps: [proj(s.caps[0]), proj(s.caps[1])], min, max };
  if (projCache.size > 4000) projCache.clear();
  projCache.set(k, hit);
  return hit;
}

/** Points on the ball's disc (as offsets in screen units) where hiding is tested. */
const DISC: [number, number][] = [[0, 0]];
for (const r of [0.45, 0.7, 0.9]) for (let i = 0; i < 16; i++) DISC.push([Math.cos((i * Math.PI) / 8) * r * BALL_R, Math.sin((i * Math.PI) / 8) * r * BALL_R]);
/** How far out from its centre (as a fraction of the radius) the ball must not be covered: only a hairline rim may be grazed. */
const RIM = 0.92;

/** Depth of triangle `o` of screen-space triangles `t` at (x, y), or null if (x, y) is outside it (by more than `slack`). */
function depthIn(t: Float64Array, o: number, x: number, y: number, slack = 1e-9): number | null {
  const x0 = t[o], y0 = t[o + 1], x1 = t[o + 3], y1 = t[o + 4], x2 = t[o + 6], y2 = t[o + 7];
  const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(den) < 1e-12) return null;
  const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
  const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
  const c = 1 - a - b;
  if (a < -slack || b < -slack || c < -slack) return null;
  return a * t[o + 2] + b * t[o + 5] + c * t[o + 8];
}

/** Closest point of screen-space triangle `o` to (x, y). */
function closestIn(t: Float64Array, o: number, x: number, y: number): [number, number] {
  if (depthIn(t, o, x, y) !== null) return [x, y];
  let best: [number, number] = [t[o], t[o + 1]], bd = Infinity;
  for (const [i, j] of [[0, 3], [3, 6], [6, 0]]) {
    const ax = t[o + i], ay = t[o + i + 1], ex = t[o + j] - ax, ey = t[o + j + 1] - ay;
    const l2 = ex * ex + ey * ey;
    const u = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / l2)) : 0;
    const px = ax + ex * u, py = ay + ey * u, d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = [px, py]; }
  }
  return best;
}

/**
 * Does any screen-space triangle in `t` cover part of the ball (centre (bx, by), front of its centre at depth bd)?
 * Sharp corners can poke into the disc between sample points, so each triangle's closest point to the centre is
 * tested too: wherever a surface is over the ball's disc and nearer than the ball's own surface there, it hides it.
 */
function covers(t: Float64Array, bx: number, by: number, bd: number): boolean {
  const lim = RIM * BALL_R, R2 = BALL_R * BALL_R;
  for (let o = 0; o < t.length; o += 9) {
    const minX = Math.min(t[o], t[o + 3], t[o + 6]), maxX = Math.max(t[o], t[o + 3], t[o + 6]);
    const minY = Math.min(t[o + 1], t[o + 4], t[o + 7]), maxY = Math.max(t[o + 1], t[o + 4], t[o + 7]);
    if (bx + BALL_R < minX || bx - BALL_R > maxX || by + BALL_R < minY || by - BALL_R > maxY) continue;
    const [cx, cy] = closestIn(t, o, bx, by);
    const d2 = (cx - bx) ** 2 + (cy - by) ** 2;
    if (d2 < lim * lim) {
      const z = depthIn(t, o, cx, cy, 1e-6);
      if (z !== null && z > bd + Math.sqrt(R2 - d2) + HIDE) return true;
    }
    for (const [dx, dy] of DISC) {
      const z = depthIn(t, o, bx + dx, by + dy);
      if (z !== null && z > bd + Math.sqrt(R2 - dx * dx - dy * dy) + HIDE) return true;
    }
  }
  return false;
}

/** The first segment that hides part of the ball drawn at `shown` (its centre, in world space). */
export function hiding(shown: readonly number[], segs: readonly Segment[], view: number, caps: CapsShown): Segment | null {
  const [bx, by, bd] = toScreen(shown, view);
  for (const seg of segs) {
    const pr = projected(seg, view);
    if (bx + BALL_R < pr.min[0] || bx - BALL_R > pr.max[0] || by + BALL_R < pr.min[1] || by - BALL_R > pr.max[1]) continue;
    if (covers(pr.tri, bx, by, bd)) return seg;
    if (caps(seg, 0) && covers(pr.caps[0], bx, by, bd)) return seg;
    if (caps(seg, 1) && covers(pr.caps[1], bx, by, bd)) return seg;
  }
  return null;
}

/** Does any of these world-space triangle soups (decorations: knobs, handles) hide the ball drawn at `shown`? */
export function hiddenByTris(shown: readonly number[], soups: readonly Float64Array[], view: number): boolean {
  const [bx, by, bd] = toScreen(shown, view);
  for (const soup of soups) {
    const t = new Float64Array(soup.length);
    for (let i = 0; i < soup.length; i += 3) t.set(toScreen([soup[i], soup[i + 1], soup[i + 2]], view), i);
    if (covers(t, bx, by, bd)) return true;
  }
  return false;
}
