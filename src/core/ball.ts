// Deterministic ball path follower (GAME_PLAN §4.4). Not a physics simulation.
import { type Continuation, type JoinWorld, findContinuation } from './joins';
import { type Dir, type Segment, exitOf, lengthOf, pointAt } from './track';
import { AXES, type Axis, type V3, VIEWS, add, eq, key, scale } from './grid';
import { blockedAt } from './screen';

export type BallMode = 'resting' | 'rolling' | 'won';

export interface BallState {
  segId: string;
  dir: Dir;
  /** Distance travelled since entering the segment in `dir`. */
  dist: number;
  mode: BallMode;
  /** Rest pad the ball is leaving; ignored until the ball reaches another node. */
  leaving?: string;
  /** Set by a bump; a second bump without moving in between means the ball is boxed in, so it waits. */
  bumped?: boolean;
  /** The segment the ball crossed from; it never counts as being in the way. */
  prev?: string;
  /** Bumps since the ball was last released; past a few it gives up and waits (never ping-pongs forever). */
  bumps?: number;
}

const MAX_BUMPS = 3;

export type BallEvent =
  | { type: 'cross'; k: number; from: V3; to: V3; segId: string }
  | { type: 'bump'; at: V3 }
  | { type: 'rest'; at: V3; pad: boolean }
  | { type: 'goal'; at: V3 }
  /**
   * Rolled off an open end. It falls straight down the screen and lands at `to`, the first surface that
   * appears beneath it (rolling on, or settling), or is lost and returns to the start. `k` is the depth
   * jump of that perspective landing: `from + k·v` is the same screen point at the landing's depth.
   */
  | { type: 'fall'; from: V3; to: V3; k: number; result: 'roll' | 'settle' | 'lost' };

export interface BallWorld extends JoinWorld {
  pads: ReadonlySet<string>;
  /** Segment whose start socket the ball returns to after falling into the void. */
  startSeg: string;
}

const EPS = 1e-9;

function segById(world: JoinWorld, id: string): Segment {
  const seg = world.segments.find((s) => s.id === id);
  if (!seg) throw new Error(`Ball on unknown segment ${id}`);
  return seg;
}

function enter(ball: BallState, c: Continuation, from: V3, events: BallEvent[]) {
  ball.prev = ball.segId;
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
    // What looks solid is solid: the ball may not roll behind something drawn in front of it.
    if (blockedAhead(world, seg, ball, nextNode)) {
      const at = pointAt(seg, ball.dir, ball.dist);
      if (ball.bumped) {
        ball.mode = 'resting';
        events.push({ type: 'rest', at, pad: true });
        break;
      }
      if ((ball.bumps = (ball.bumps ?? 0) + 1) > MAX_BUMPS) {
        ball.mode = 'resting';
        events.push({ type: 'rest', at, pad: true });
        break;
      }
      ball.dir = (-ball.dir) as Dir;
      ball.dist = len - ball.dist;
      ball.bumped = true;
      events.push({ type: 'bump', at });
      break;
    }
    ball.bumped = false;
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
    // An open end with nothing joined: the ball rolls off and falls (unless it was heading straight up).
    if ((exit.flag === 'open' || exit.flag === 'drop') && exit.t !== '+y') {
      fall(ball, world, exit.t, here, events);
      break;
    }
    // Dead end (a capped end): bump softly and roll back.
    if ((ball.bumps = (ball.bumps ?? 0) + 1) > MAX_BUMPS) {
      ball.mode = 'resting';
      events.push({ type: 'rest', at: here, pad: true });
      break;
    }
    ball.dir = (-ball.dir) as Dir;
    ball.dist = 0;
    events.push({ type: 'bump', at: here });
    break;
  }
  return events;
}

/**
 * Would the ball, rolling on to `nextNode`, pass behind a solid that is drawn in front of it?
 * The track it's on, its physical neighbours and whatever it's about to join are exempt.
 */
function blockedAhead(world: BallWorld, seg: Segment, ball: BallState, nextNode: number): boolean {
  const len = lengthOf(seg);
  let target: Continuation | null = null;
  if (nextNode >= len - EPS) {
    const exit = exitOf(seg, ball.dir);
    if (exit.flag === 'open') target = findContinuation(world, exit, seg);
  } else {
    const t = ball.dir === 1 ? seg.t0 : exitOf(seg, -1).t;
    target = findContinuation(world, { p: nodePoint(seg, ball.dir, nextNode), t, n: seg.n0 }, seg, true);
  }
  // Exempt: this track, its physical neighbours, whatever it joins at either end (in this view),
  // what the ball is about to enter, and what it just came from. Seams are where these overlap on screen.
  const exempt = new Set<string>([seg.id]);
  const exemptPieces = new Set<string>();
  const add = (o: Segment | undefined) => { if (o) { exempt.add(o.id); if (o.pieceId) exemptPieces.add(o.pieceId); } };
  add(seg);
  add(target?.seg);
  add(world.segments.find((o) => o.id === ball.prev));
  for (const d of [1, -1] as const) {
    const e = exitOf(seg, d);
    if (e.flag === 'open') add(findContinuation(world, e, seg)?.seg);
  }
  const touches = (o: Segment) => [o.from, o.to].some((a) => eq(a, seg.from) || eq(a, seg.to));
  const solids = world.segments.filter((o) =>
    !exempt.has(o.id) && !touches(o) &&
    !(o.pieceId && (world.moving.has(o.pieceId) || exemptPieces.has(o.pieceId))));
  if (!solids.length) return false;
  for (let i = 1; i <= 3; i++) {
    const d = ball.dist + ((nextNode - ball.dist) * i) / 3;
    if (blockedAt(pointAt(seg, ball.dir, d), solids, world.view)) return true;
  }
  return false;
}

/**
 * Falling (GAME_PLAN §4.6, perspective landing): the ball drops straight down the *screen*. Leaving an end
 * horizontally it carries one cell forward first; leaving downward it drops straight. It lands on the first
 * floor that appears beneath it on screen, at whatever depth (q = col − d·ŷ + k·v, smallest d > 0, ties
 * nearest the camera). On a floor running the same way it keeps rolling; otherwise it settles and waits.
 * With nothing beneath it on screen, it's lost and returns to the start socket.
 */
function fall(ball: BallState, world: BallWorld, t: Axis, here: V3, events: BallEvent[]) {
  const col: V3 = t === '-y' ? here : add(here, AXES[t]);
  const v = VIEWS[world.view];
  let best: { seg: Segment; d: number; q: V3; k: number; drop: number } | null = null;
  for (const s of world.segments) {
    if (s.kind !== 'straight' || s.n0 !== '+y' || s.t0[1] === 'y') continue;
    if (s.pieceId && world.moving.has(s.pieceId)) continue;
    const len = lengthOf(s);
    for (let d = 0; d <= len; d++) {
      const q = add(s.from, scale(AXES[s.t0], d));
      const k = (q[0] - col[0]) / v[0];
      if (!Number.isInteger(k) || q[2] - col[2] !== k * v[2]) continue;
      const drop = col[1] + k * v[1] - q[1];
      if (drop <= 0) continue;
      if (!best || drop < best.drop || (drop === best.drop && k > best.k)) best = { seg: s, d, q, k: k + 0, drop };
    }
  }
  if (!best) {
    events.push({ type: 'fall', from: here, to: add(col, [0, -10, 0]), k: 0, result: 'lost' });
    Object.assign(ball, { segId: world.startSeg, dir: 1, dist: 0, mode: 'resting', leaving: undefined, bumped: false });
    return;
  }
  const { seg, d, q, k } = best;
  const len = lengthOf(seg);
  if (t !== '-y' && seg.t0[1] === t[1]) {
    const dir: Dir = seg.t0 === t ? 1 : -1;
    Object.assign(ball, { segId: seg.id, dir, dist: dir === 1 ? d : len - d, leaving: undefined, bumped: false });
    events.push({ type: 'fall', from: here, to: q, k, result: 'roll' });
    return;
  }
  Object.assign(ball, { segId: seg.id, dir: 1, dist: d, mode: 'resting', leaving: key(q), bumped: false });
  events.push({ type: 'fall', from: here, to: q, k, result: 'settle' });
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
  const ball: BallState = { ...start, mode: 'rolling', bumps: 0, bumped: false };
  const events: BallEvent[] = [];
  for (let i = 0; i < 4000; i++) {
    events.push(...advance(ball, world, 0.5));
    if (ball.mode === 'won') return { outcome: 'goal', ball, events };
    if (ball.mode === 'resting') return { outcome: 'rest', ball, events };
  }
  return { outcome: 'loop', ball, events };
}
