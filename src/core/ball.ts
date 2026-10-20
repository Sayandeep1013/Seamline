// Deterministic ball path follower (GAME_PLAN §4.4). Not a physics simulation.
import { type Continuation, type JoinWorld, findContinuation } from './joins';
import { type Dir, type Segment, exitOf, lengthOf, pointAt } from './track';
import { AXES, type V3, add, key, scale } from './grid';

export type BallMode = 'resting' | 'rolling' | 'won';

export interface BallState {
  segId: string;
  dir: Dir;
  /** Distance travelled since entering the segment in `dir`. */
  dist: number;
  mode: BallMode;
  /** Rest pad the ball is leaving; ignored until the ball reaches another node. */
  leaving?: string;
}

export type BallEvent =
  | { type: 'cross'; k: number; from: V3; to: V3; segId: string }
  | { type: 'bump'; at: V3 }
  | { type: 'rest'; at: V3; pad: boolean }
  | { type: 'goal'; at: V3 };

export interface BallWorld extends JoinWorld {
  pads: ReadonlySet<string>;
}

const EPS = 1e-9;

function segById(world: JoinWorld, id: string): Segment {
  const seg = world.segments.find((s) => s.id === id);
  if (!seg) throw new Error(`Ball on unknown segment ${id}`);
  return seg;
}

function enter(ball: BallState, c: Continuation, from: V3, events: BallEvent[]) {
  ball.segId = c.seg.id;
  ball.dir = c.dir;
  ball.dist = c.dist;
  events.push({ type: 'cross', k: c.k, from, to: pointAt(c.seg, c.dir, c.dist), segId: c.seg.id });
}

/** Integer grid point at a node of a straight (exact, unlike the float frame maths). */
function nodePoint(seg: Segment, dir: Dir, dist: number): V3 {
  if (seg.kind !== 'straight') return dist === 0 ? (dir === 1 ? seg.from : seg.to) : (dir === 1 ? seg.to : seg.from);
  const start = dir === 1 ? seg.from : seg.to;
  const t = dir === 1 ? seg.t0 : (seg.t0[0] === '+' ? '-' : '+') + seg.t0[1];
  return add(start, scale(AXES[t as keyof typeof AXES], dist));
}

/**
 * Move the ball `distance` units along the track, resolving joins and rest pads at each node.
 * Mutates `ball`. Stops early on bump, rest or goal (the caller re-accelerates).
 */
export function advance(ball: BallState, world: BallWorld, distance: number): BallEvent[] {
  const events: BallEvent[] = [];
  let remaining = distance;
  let guard = 0;
  while (remaining > EPS && ball.mode === 'rolling') {
    if (++guard > 10000) throw new Error('advance: runaway loop');
    const seg = segById(world, ball.segId);
    const len = lengthOf(seg);
    const nextNode = seg.kind === 'straight' ? Math.min(Math.floor(ball.dist + EPS) + 1, len) : len;
    const step = nextNode - ball.dist;
    if (remaining < step - EPS) {
      ball.dist += remaining;
      break;
    }
    ball.dist = nextNode;
    remaining -= step;
    const here = nodePoint(seg, ball.dir, ball.dist);
    const leaving = ball.leaving;
    ball.leaving = undefined;

    const padKey = key(here);
    if (seg.pieceId === null && world.pads.has(padKey) && leaving !== padKey) {
      ball.mode = 'resting';
      ball.leaving = padKey;
      events.push({ type: 'rest', at: here, pad: true });
      break;
    }

    if (ball.dist < len - EPS) {
      // Interior node: a movable piece may intercept through-track.
      const t = ball.dir === 1 ? seg.t0 : exitOf(seg, -1).t;
      const c = findContinuation(world, { p: here, t, n: seg.n0 }, seg, true);
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
      events.push({ type: 'rest', at: here, pad: false });
      break;
    }
    const c = exit.flag === 'open' ? findContinuation(world, exit, seg) : null;
    if (c) {
      enter(ball, c, here, events);
      continue;
    }
    // Dead end (cap, unjoined open end, or drop until landing exists): bump softly and roll back.
    ball.dir = (-ball.dir) as Dir;
    ball.dist = 0;
    events.push({ type: 'bump', at: here });
    break;
  }
  return events;
}

/** What happens at the end the ball is heading for, without moving it. */
export function upcoming(ball: BallState, world: JoinWorld): { remaining: number; flag: string; k: number | null } {
  const seg = segById(world, ball.segId);
  const exit = exitOf(seg, ball.dir);
  const c = exit.flag === 'open' ? findContinuation(world, exit, seg) : null;
  return { remaining: lengthOf(seg) - ball.dist, flag: c ? 'join' : exit.flag, k: c ? c.k : null };
}

export type Outcome = 'goal' | 'rest' | 'loop';

/** Release the ball and run until it reaches the goal, comes to rest, or is judged to loop forever. */
export function simulate(world: BallWorld, start: BallState): { outcome: Outcome; ball: BallState; events: BallEvent[] } {
  const ball: BallState = { ...start, mode: 'rolling' };
  const events: BallEvent[] = [];
  for (let i = 0; i < 4000; i++) {
    events.push(...advance(ball, world, 0.5));
    if (ball.mode === 'won') return { outcome: 'goal', ball, events };
    if (ball.mode === 'resting') return { outcome: 'rest', ball, events };
  }
  return { outcome: 'loop', ball, events };
}
