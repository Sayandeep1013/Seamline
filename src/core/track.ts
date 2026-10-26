// Track segments and endpoints (GAME_PLAN §4.2). A segment is the path of the ball's centre.
import { AXES, type Axis, type AxisName, type V3, add, cross, directionOf, manhattan, negate, rot90, rotAxis, scale, sub } from './grid';

/** open = joinable, cap = dead end (bounce), start = start socket, goal = chime bowl, drop = perspective landing (later). */
export type EndFlag = 'open' | 'cap' | 'start' | 'goal' | 'drop';

/**
 * straight — along one axis.
 * concave  — radius-1 quarter-pipe, ball on the inside (wall → floor, floor → wall).
 * convex   — radius-1 rounded edge, ball on the outside (floor → down a wall).
 * turn     — radius-1 flat bend; the surface normal stays the same.
 */
export type SegKind = 'straight' | 'concave' | 'convex' | 'turn';

export interface Segment {
  id: string;
  /** Movable piece this segment belongs to, or null for fixed track. */
  pieceId: string | null;
  kind: SegKind;
  from: V3;
  to: V3;
  /** Tangent and surface normal at `from` (t0, n0) and at `to` (t1, n1), for travel from→to. */
  t0: Axis; n0: Axis;
  t1: Axis; n1: Axis;
  ends: readonly [EndFlag, EndFlag];
  /** Slab thickness under the riding surface (default 0.6). The Star's blades are thin so they never cover each other's lanes. */
  depth?: number;
  /** Star blades taper: fine at the tips, swelling to `depth` mid-blade. */
  taper?: boolean;
}

export const DEFAULT_DEPTH = 0.6;
export const depthOf = (seg: Segment) => seg.depth ?? DEFAULT_DEPTH;
/** Slab thickness at fraction `u` (0..1) along the segment: what is drawn and what the ball collides with. */
export const depthAlong = (seg: Segment, u: number) =>
  seg.taper ? 0.1 + (depthOf(seg) - 0.1) * Math.sin(Math.PI * u) : depthOf(seg);

export interface Endpoint {
  p: V3;
  t: Axis;
  n: Axis;
  flag: EndFlag;
}

/** +1 travels from→to, −1 travels to→from. */
export type Dir = 1 | -1;

export function straight(id: string, pieceId: string | null, from: V3, to: V3, n: Axis, ends: readonly [EndFlag, EndFlag]): Segment {
  const t = directionOf(from, to);
  if (!t) throw new Error(`Segment ${id} is not a straight along one axis`);
  if (t[1] === n[1]) throw new Error(`Segment ${id}: normal must be perpendicular to its direction`);
  return { id, pieceId, kind: 'straight', from, to, t0: t, n0: n, t1: t, n1: n, ends };
}

/** Arc starting at p0 heading t0 with normal n0. For a turn, `side` is the direction it bends toward. */
export function arc(id: string, pieceId: string | null, kind: Exclude<SegKind, 'straight'>, p0: V3, t0: Axis, n0: Axis,
  ends: readonly [EndFlag, EndFlag], side?: Axis): Segment {
  if (t0[1] === n0[1]) throw new Error(`Segment ${id}: normal must be perpendicular to its direction`);
  const T = AXES[t0], N = AXES[n0];
  if (kind === 'concave') {
    return { id, pieceId, kind, from: p0, to: add(add(p0, N), T), t0, n0, t1: n0, n1: negate(t0), ends };
  }
  if (kind === 'convex') {
    return { id, pieceId, kind, from: p0, to: add(sub(p0, N), T), t0, n0, t1: negate(n0), n1: t0, ends };
  }
  if (!side || side[1] === t0[1] || side[1] === n0[1]) throw new Error(`Segment ${id}: turn needs a side perpendicular to t and n`);
  return { id, pieceId, kind, from: p0, to: add(add(p0, AXES[side]), T), t0, n0, t1: side, n1: n0, ends };
}

export const lengthOf = (seg: Segment): number =>
  seg.kind === 'straight' ? manhattan(sub(seg.to, seg.from)) : Math.PI / 2;

/** Where the ball enters the segment when travelling in `dir`. */
export function entryOf(seg: Segment, dir: Dir): Endpoint {
  return dir === 1
    ? { p: seg.from, t: seg.t0, n: seg.n0, flag: seg.ends[0] }
    : { p: seg.to, t: negate(seg.t1), n: seg.n1, flag: seg.ends[1] };
}

/** Where the ball leaves the segment when travelling in `dir`. */
export function exitOf(seg: Segment, dir: Dir): Endpoint {
  return dir === 1
    ? { p: seg.to, t: seg.t1, n: seg.n1, flag: seg.ends[1] }
    : { p: seg.from, t: negate(seg.t0), n: seg.n0, flag: seg.ends[0] };
}

/** Centre of curvature for arcs. */
export function centerOf(seg: Segment): V3 {
  if (seg.kind === 'concave') return add(seg.from, AXES[seg.n0]);
  if (seg.kind === 'convex') return sub(seg.from, AXES[seg.n0]);
  if (seg.kind === 'turn') return add(seg.from, AXES[seg.t1]);
  throw new Error('straights have no centre');
}

/** Position, unit tangent (direction of travel) and surface normal `dist` after entering in `dir`. */
export function frameAt(seg: Segment, dir: Dir, dist: number): { p: V3; t: V3; n: V3 } {
  if (seg.kind === 'straight') {
    const e = entryOf(seg, dir);
    return { p: add(e.p, scale(AXES[e.t], dist)), t: AXES[e.t], n: AXES[e.n] };
  }
  const L = Math.PI / 2;
  const th = dir === 1 ? dist : L - dist;
  const c = Math.cos(th), s = Math.sin(th);
  const T = AXES[seg.t0], N = AXES[seg.n0];
  const C = centerOf(seg);
  let p: V3, t: V3, n: V3;
  if (seg.kind === 'concave') {
    p = add(C, add(scale(N, -c), scale(T, s)));
    t = add(scale(N, s), scale(T, c));
    n = add(scale(N, c), scale(T, -s));
  } else if (seg.kind === 'convex') {
    p = add(C, add(scale(N, c), scale(T, s)));
    t = add(scale(N, -s), scale(T, c));
    n = add(scale(N, c), scale(T, s));
  } else {
    const S = AXES[seg.t1];
    p = add(C, add(scale(S, -c), scale(T, s)));
    t = add(scale(S, s), scale(T, c));
    n = N;
  }
  return { p, t: dir === 1 ? t : scale(t, -1), n };
}

export const pointAt = (seg: Segment, dir: Dir, dist: number): V3 => frameAt(seg, dir, dist).p;

/** Axis the segment's cross-section width runs along (constant along the whole segment). */
export function widthAxis(seg: Segment): V3 {
  return cross(AXES[seg.t0], AXES[seg.n0]);
}

export interface Placement {
  offset: V3;
  rotation?: { axis: AxisName; pivot: V3; k: number };
}

/** Rotate about the pivot by k quarter turns, then translate. Stays on the integer grid. */
export function place(seg: Segment, pl: Placement): Segment {
  const r = pl.rotation;
  const pt = (p: V3): V3 => add(r ? add(r.pivot, rot90(sub(p, r.pivot), r.axis, r.k)) : p, pl.offset);
  const ax = (a: Axis): Axis => (r ? rotAxis(a, r.axis, r.k) : a);
  return { ...seg, from: pt(seg.from), to: pt(seg.to), t0: ax(seg.t0), n0: ax(seg.n0), t1: ax(seg.t1), n1: ax(seg.n1) };
}
