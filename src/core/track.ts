// Track segments and endpoints (GAME_PLAN §4.2). A segment is the path of the ball's centre.
import { AXES, type Axis, type V3, add, directionOf, manhattan, negate, scale, sub } from './grid';

/** open = joinable, cap = dead end (bounce), start = start socket, goal = chime bowl, drop = perspective landing (L8+). */
export type EndFlag = 'open' | 'cap' | 'start' | 'goal' | 'drop';

export interface Segment {
  id: string;
  /** Movable piece this segment belongs to, or null for fixed track. */
  pieceId: string | null;
  from: V3;
  to: V3;
  /** Surface normal: the side the ball rides on. */
  n: Axis;
  ends: readonly [EndFlag, EndFlag];
}

export interface Endpoint {
  p: V3;
  t: Axis;
  n: Axis;
  flag: EndFlag;
}

/** +1 travels from→to, −1 travels to→from. */
export type Dir = 1 | -1;

export function tangentOf(seg: Segment): Axis {
  const t = directionOf(seg.from, seg.to);
  if (!t) throw new Error(`Segment ${seg.id} is not a straight along one axis`);
  return t;
}

export const lengthOf = (seg: Segment): number => manhattan(sub(seg.to, seg.from));

export function travelTangent(seg: Segment, dir: Dir): Axis {
  const t = tangentOf(seg);
  return dir === 1 ? t : negate(t);
}

/** Where the ball enters the segment when travelling in `dir`. */
export function entryOf(seg: Segment, dir: Dir): Endpoint {
  return dir === 1
    ? { p: seg.from, t: tangentOf(seg), n: seg.n, flag: seg.ends[0] }
    : { p: seg.to, t: negate(tangentOf(seg)), n: seg.n, flag: seg.ends[1] };
}

/** Where the ball leaves the segment when travelling in `dir`. */
export function exitOf(seg: Segment, dir: Dir): Endpoint {
  return dir === 1
    ? { p: seg.to, t: tangentOf(seg), n: seg.n, flag: seg.ends[1] }
    : { p: seg.from, t: negate(tangentOf(seg)), n: seg.n, flag: seg.ends[0] };
}

/** Ball-centre position `dist` units after entering in `dir`. May be fractional. */
export function pointAt(seg: Segment, dir: Dir, dist: number): V3 {
  const e = entryOf(seg, dir);
  return add(e.p, scale(AXES[e.t], dist));
}

export function translate(seg: Segment, offset: V3): Segment {
  return { ...seg, from: add(seg.from, offset), to: add(seg.to, offset) };
}
