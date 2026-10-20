// Deterministic ball path follower (GAME_PLAN §4.4). Not a physics simulation.
import { type Continuation, type JoinWorld, findContinuation } from './joins';
import { type Dir, type Segment, exitOf, lengthOf, pointAt, travelTangent } from './track';
import type { V3 } from './grid';

export type BallMode = 'resting' | 'rolling' | 'won';

export interface BallState {
  segId: string;
  dir: Dir;
  /** Distance travelled since entering the segment in `dir`. */
  dist: number;
  mode: BallMode;
}

export type BallEvent =
  | { type: 'cross'; k: number; from: V3; to: V3; segId: string }
  | { type: 'bump'; at: V3 }
  | { type: 'rest'; at: V3 }
  | { type: 'goal'; at: V3 };

const EPS = 1e-9;

function segById(world: JoinWorld, id: string): Segment {
  const seg = world.segments.find((s) => s.id === id);
  if (!seg) throw new Error(`Ball on unknown segment ${id}`);
  return seg;
}

function enter(ball: BallState, c: Continuation, from: V3, events: BallEvent[]) {
  ball.segId = c.seg.id;
  ball.dir = c.dir;
  ball.dist = 0;
  events.push({ type: 'cross', k: c.k, from, to: pointAt(c.seg, c.dir, 0), segId: c.seg.id });
}

/**
 * Move the ball `distance` units along the track, resolving joins at each integer node.
 * Mutates `ball`. Stops early on bump, rest or goal (the caller re-accelerates).
 */
export function advance(ball: BallState, world: JoinWorld, distance: number): BallEvent[] {
  const events: BallEvent[] = [];
  let remaining = distance;
  let guard = 0;
  while (remaining > EPS && ball.mode === 'rolling') {
    if (++guard > 10000) throw new Error('advance: runaway loop');
    const seg = segById(world, ball.segId);
    const len = lengthOf(seg);
    const nextNode = Math.min(Math.floor(ball.dist + EPS) + 1, len);
    const step = nextNode - ball.dist;
    if (remaining < step - EPS) {
      ball.dist += remaining;
      break;
    }
    ball.dist = nextNode;
    remaining -= step;
    const t = travelTangent(seg, ball.dir);
    const here = pointAt(seg, ball.dir, ball.dist);

    if (ball.dist < len) {
      // Interior node: a movable piece may intercept through-track.
      const c = findContinuation(world, { p: here, t, n: seg.n }, seg, true);
      if (c) enter(ball, c, here, events);
      continue;
    }

    const exit = exitOf(seg, ball.dir);
    if (exit.flag === 'goal') {
      ball.mode = 'won';
      events.push({ type: 'goal', at: here });
      break;
    }
    if (exit.flag === 'start') {
      ball.mode = 'resting';
      ball.dir = (-ball.dir) as Dir;
      ball.dist = 0;
      events.push({ type: 'rest', at: here });
      break;
    }
    const c = exit.flag === 'open' ? findContinuation(world, exit, seg) : null;
    if (c) {
      enter(ball, c, here, events);
      continue;
    }
    // Dead end (cap, unjoined open end, or drop until L8): bump softly and roll back.
    ball.dir = (-ball.dir) as Dir;
    ball.dist = 0;
    events.push({ type: 'bump', at: here });
    break;
  }
  return events;
}

/** What happens next at the end the ball is heading for, without moving it. */
export function upcoming(ball: BallState, world: JoinWorld): { remaining: number; flag: string; k: number | null } {
  const seg = segById(world, ball.segId);
  const exit = exitOf(seg, ball.dir);
  const c = exit.flag === 'open' ? findContinuation(world, exit, seg) : null;
  return { remaining: lengthOf(seg) - ball.dist, flag: c ? 'join' : exit.flag, k: c ? c.k : null };
}

export type Outcome = 'goal' | 'stuck' | 'loop';

/** Release the ball and run to completion (for tests and the solver). */
export function simulate(world: JoinWorld, start: BallState): { outcome: Outcome; events: BallEvent[] } {
  const ball: BallState = { ...start, mode: 'rolling' };
  const events: BallEvent[] = [];
  for (let i = 0; i < 2000; i++) {
    events.push(...advance(ball, world, 0.5));
    if (ball.mode === 'won') return { outcome: 'goal', events };
    if (ball.mode === 'resting') return { outcome: 'stuck', events };
  }
  return { outcome: 'loop', events };
}
