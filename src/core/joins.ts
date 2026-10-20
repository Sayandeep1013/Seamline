// The join rule (GAME_PLAN §4.3) and continuation priority (§4.4).
import { type V3, VIEWS, sub, viewMultiple } from './grid';
import { type Dir, type Endpoint, type Segment, entryOf } from './track';

/** Returns k if exit A joins entry B in view v (A.p − B.p = k·v, same tangent, same normal), else null. */
export function joinK(a: Pick<Endpoint, 'p' | 't' | 'n'>, b: Endpoint, v: V3): number | null {
  if (b.flag !== 'open') return null;
  if (a.t !== b.t || a.n !== b.n) return null;
  return viewMultiple(sub(a.p, b.p), v);
}

export interface Continuation {
  seg: Segment;
  dir: Dir;
  k: number;
}

export interface JoinWorld {
  segments: readonly Segment[];
  view: number;
  /** Pieces currently in the player's hand or animating; they join nothing. */
  moving: ReadonlySet<string>;
}

function joinable(world: JoinWorld, seg: Segment): boolean {
  return seg.pieceId === null || !world.moving.has(seg.pieceId);
}

function better(a: Continuation, b: Continuation | null): boolean {
  if (!b) return true;
  const ak = Math.abs(a.k), bk = Math.abs(b.k);
  if (ak !== bk) return ak < bk;
  return a.seg.id < b.seg.id;
}

/**
 * Find where the ball goes from point `at` (moving along t, riding on n), leaving segment `current`.
 * Priority: movable piece → physical (k = 0) → perceptual (smallest |k|, then id).
 * With `piecesOnly`, only movable pieces are considered (mid-track interception).
 */
export function findContinuation(
  world: JoinWorld,
  at: Pick<Endpoint, 'p' | 't' | 'n'>,
  current: Segment,
  piecesOnly = false,
): Continuation | null {
  const v = VIEWS[world.view];
  let piece: Continuation | null = null;
  let physical: Continuation | null = null;
  let perceptual: Continuation | null = null;
  for (const seg of world.segments) {
    if (seg.id === current.id || !joinable(world, seg)) continue;
    if (current.pieceId !== null && seg.pieceId === current.pieceId) continue;
    if (piecesOnly && seg.pieceId === null) continue;
    for (const dir of [1, -1] as const) {
      const k = joinK(at, entryOf(seg, dir), v);
      if (k === null) continue;
      const c = { seg, dir, k };
      if (seg.pieceId !== null) { if (better(c, piece)) piece = c; }
      else if (k === 0) { if (better(c, physical)) physical = c; }
      else if (better(c, perceptual)) perceptual = c;
    }
  }
  return piece ?? physical ?? perceptual;
}
