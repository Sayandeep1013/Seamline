// Deterministic ball path follower with momentum and contact (GAME_PLAN §4.4).
import { type Continuation, type JoinWorld, capsShown, findContinuation } from './joins';
import { type CapsShown, hiding, overlapping, shapeOf, toScreen } from './contact';
import { type Dir, type Segment, exitOf, frameAt, lengthOf, pointAt } from './track';
import { AXES, type Axis, type V3, VIEWS, add, key, scale } from './grid';

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
  /** Speed along `dir` in tiles per second (momentum; see `stepBall`). */
  speed?: number;
  /** Times gravity has turned the ball around since release; a ball rocking in a dip settles. */
  turns?: number;
  /** Last perceptual crossing's k, and how much further the ball is drawn at the nearer side's depth. */
  crossK?: number;
  crossLeft?: number;
}

const MAX_BUMPS = 3;

export type BallEvent =
  | { type: 'cross'; k: number; from: V3; to: V3; segId: string }
  /** Bounced back; `piece` is the movable piece it hit, if it hit one (so the game can make it react). */
  | { type: 'bump'; at: V3; piece?: string }
  | { type: 'rest'; at: V3; pad: boolean }
  | { type: 'goal'; at: V3 }
  /**
   * Rolled off an open end. It falls straight down the screen and lands at `to`, the first surface that
   * appears beneath it (rolling on, or settling), or is lost and returns to the start. `k` is the depth
   * jump of that perspective landing: `from + k·v` is the same screen point at the landing's depth. While
   * in the air it is drawn a further `front`·v toward the camera, in front of everything.
   */
  | { type: 'fall'; from: V3; to: V3; k: number; front: number; result: 'roll' | 'settle' | 'lost' };

export interface BallWorld extends JoinWorld {
  pads: ReadonlySet<string>;
  /** Segment whose start socket the ball returns to after falling into the void. */
  startSeg: string;
}

const EPS = 1e-9;

/**
 * Around a perceptual crossing the ball is drawn at the nearer side's depth, this far either side. The two pieces
 * overlap on screen near their ends (a slab's width runs diagonally), up to about 0.64 + the ball's radius along
 * the track, so the ball keeps the nearer depth until it is clear of that.
 */
export const CROSS_DRAW = 1.0;
/** The ball is drawn this far toward the camera (invisible on screen) so its own groove's lip never hides it. */
export const BALL_LIFT = 0.5;

/**
 * Where the ball is drawn: its true position, slid along the view line (which doesn't move it on screen) to
 * the nearer side of a perceptual crossing it is approaching or has just made, plus BALL_LIFT.
 */
export function drawnAt(ball: BallState, world: JoinWorld): V3 {
  const seg = segById(world, ball.segId);
  const p = pointAt(seg, ball.dir, Math.min(ball.dist, lengthOf(seg)));
  // A ball waiting on a seam (a cradle at a join) is drawn at the nearer side too.
  const len = lengthOf(seg);
  const nextNode = seg.kind === 'straight' ? Math.min(Math.floor(ball.dist + EPS) + 1, len) : len;
  const k = ball.mode === 'won' ? 0 : drawnK(nextCrossing(world, seg, ball.dir, nextNode), nextNode - ball.dist, ball.crossK, ball.crossLeft ?? 0);
  return lifted(p, k, world.view);
}

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
  if (c.k !== 0) { ball.crossK = c.k; ball.crossLeft = CROSS_DRAW; }
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
    // What looks solid is solid: the ball rolls right up to anything drawn in front of its path,
    // touches it, and bounces back (it never slips behind it).
    const contact = firstContact(world, seg, ball, nextNode, ball.dist + Math.min(step, remaining));
    if (contact !== null) {
      const moved = contact.dist > ball.dist + EPS;
      ball.dist = contact.dist;
      const at = pointAt(seg, ball.dir, ball.dist);
      // Blocked both ways without moving: boxed in, so it waits for the player.
      if (ball.bumped && !moved) {
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
      events.push({ type: 'bump', at, piece: contact.hit.pieceId ?? undefined });
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
      const c = nextCrossing(world, seg, ball.dir, ball.dist);
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
    // Joined onward (or caught by a piece, even at a capped end).
    const c = nextCrossing(world, seg, ball.dir, len);
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
 * Rolling from the ball's position to distance `to` (no further than `nextNode`), where does it first touch
 * something? Tested against the exact drawn triangles of every solid, with no exemptions (GAME_PLAN §4.4b):
 * its sphere may never sink into a solid, and no part of it as drawn may be hidden behind one. The only
 * thing allowed to hide it is the track it rides and track physically joined to that (the ball going round
 * the back of its own pillar is real; slipping behind something else is not).
 */
function firstContact(world: BallWorld, seg: Segment, ball: BallState, nextNode: number, to: number): { dist: number; hit: Segment } | null {
  const target = nextCrossing(world, seg, ball.dir, nextNode);
  const caps = capsOf(world);
  const solids = world.segments.filter((o) => !(o.pieceId && world.moving.has(o.pieceId)));
  const physical = new Set([seg.id]);
  for (const d of [1, -1] as const) {
    const e = exitOf(seg, d);
    const c = e.flag === 'open' ? findContinuation(world, e, seg) : null;
    if (c && c.k === 0) physical.add(c.seg.id);
  }
  const screens = solids.filter((o) => !physical.has(o.id));
  const from = ball.dist;
  const n = Math.max(1, Math.ceil((to - from) / 0.05));
  for (let i = 0; i <= n; i++) {
    const d = from + ((to - from) * i) / n;
    const p = pointAt(seg, ball.dir, d);
    const k = drawnK(target, nextNode - d, ball.crossK, (ball.crossLeft ?? 0) - (d - from));
    const hit = overlapping(p, solids, caps) ?? hiding(lifted(p, k, world.view), screens, world.view, caps);
    if (hit) return { dist: Math.max(from, d - (i === 0 ? 0 : (to - from) / n)), hit };
  }
  return null;
}

/** Where the ball goes at the node `nextNode` along `seg` (a piece may catch it anywhere, even at a capped end). */
function nextCrossing(world: JoinWorld, seg: Segment, dir: Dir, nextNode: number): Continuation | null {
  const len = lengthOf(seg);
  if (nextNode < len - EPS) {
    const t = dir === 1 ? seg.t0 : exitOf(seg, -1).t;
    return findContinuation(world, { p: nodePoint(seg, dir, nextNode), t, n: seg.n0 }, seg, true);
  }
  const exit = exitOf(seg, dir);
  if (exit.flag === 'open') return findContinuation(world, exit, seg);
  if (exit.flag === 'cap') return findContinuation(world, exit, seg, true);
  return null;
}

/** Depth shift (in multiples of v) the ball is drawn at: the nearer side of a crossing it is near. */
function drawnK(next: Continuation | null, toNode: number, crossK: number | undefined, crossLeft: number): number {
  if (next && next.k !== 0 && toNode < CROSS_DRAW) return Math.max(0, -next.k);
  if (crossLeft > 0) return Math.max(0, crossK ?? 0);
  return 0;
}

function lifted(p: V3, k: number, view: number): V3 {
  const v = VIEWS[view], l = Math.hypot(v[0], v[1], v[2]);
  return [p[0] + v[0] * (k + BALL_LIFT / l), p[1] + v[1] * (k + BALL_LIFT / l), p[2] + v[2] * (k + BALL_LIFT / l)];
}

const capsCache = new WeakMap<object, CapsShown>();
/** End-face visibility for this world (cached per world object). */
function capsOf(world: JoinWorld): CapsShown {
  let c = capsCache.get(world);
  if (!c) { c = capsShown(world); capsCache.set(world, c); }
  return c;
}

/** How far in front of everything a falling ball is drawn (multiples of v): nothing can hide it mid-air. */
function frontK(world: JoinWorld, p: V3): number {
  const v = VIEWS[world.view], l = Math.hypot(v[0], v[1], v[2]);
  let max = -Infinity;
  for (const s of world.segments) {
    const sh = shapeOf(s);
    for (const x of [sh.min[0], sh.max[0]]) for (const y of [sh.min[1], sh.max[1]]) for (const z of [sh.min[2], sh.max[2]]) {
      max = Math.max(max, (x * v[0] + y * v[1] + z * v[2]) / l);
    }
  }
  const here = (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / l;
  return Math.max(0, (max - here + 1) / l);
}

/**
 * Falling (GAME_PLAN §4.6, perspective landing): the ball drops straight down the *screen*, drawn in front
 * of everything so nothing can hide it. Leaving an end horizontally it carries one cell forward first;
 * leaving downward it drops straight. It lands on the first floor drawn beneath it on screen, at whatever
 * depth, anywhere along that floor (ties nearest the camera), provided it would be in plain view sitting
 * there. On a floor running the same way it keeps rolling; otherwise it settles and waits. With nothing
 * beneath it on screen, it's lost and returns to the start socket.
 */
function fall(ball: BallState, world: BallWorld, t: Axis, here: V3, events: BallEvent[]) {
  const col: V3 = t === '-y' ? here : add(here, AXES[t]);
  const v = VIEWS[world.view], l2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const [cx, cy] = toScreen(col, world.view);
  const caps = capsOf(world);
  const front = frontK(world, here);
  let best: { seg: Segment; s: number; q: V3; sy: number; depth: number } | null = null;
  for (const seg of world.segments) {
    if (seg.kind !== 'straight' || seg.n0 !== '+y' || seg.t0[1] === 'y') continue;
    if (seg.pieceId && world.moving.has(seg.pieceId)) continue;
    const len = lengthOf(seg);
    const [ax] = toScreen(seg.from, world.view), [bx] = toScreen(seg.to, world.view);
    if (Math.abs(bx - ax) < 1e-9) continue;
    const s = ((cx - ax) / (bx - ax)) * len;
    if (s < -EPS || s > len + EPS) continue;
    const q = pointAt(seg, 1, Math.min(len, Math.max(0, s)));
    const [, sy, depth] = toScreen(q, world.view);
    if (sy >= cy - EPS) continue;
    if (best && (sy < best.sy - EPS || (Math.abs(sy - best.sy) < EPS && depth <= best.depth))) continue;
    // It must be in plain view sitting there, and not inside anything.
    const others = world.segments.filter((o) => o.id !== seg.id);
    if (overlapping(q, world.segments, caps) || hiding(lifted(q, 0, world.view), others, world.view, caps)) continue;
    best = { seg, s: Math.min(len, Math.max(0, s)), q, sy, depth };
  }
  if (!best) {
    events.push({ type: 'fall', from: here, to: add(col, [0, -10, 0]), k: front, front: 0, result: 'lost' });
    Object.assign(ball, { segId: world.startSeg, dir: 1, dist: 0, mode: 'resting', leaving: undefined, bumped: false });
    return;
  }
  const { seg, s, q } = best;
  const len = lengthOf(seg);
  // Shift that puts the exit point at the landing's depth (moving along v doesn't move it on screen).
  const k = ((q[0] - here[0]) * v[0] + (q[1] - here[1]) * v[1] + (q[2] - here[2]) * v[2]) / l2;
  const fr = Math.max(0, front - k);
  if (t !== '-y' && seg.t0[1] === t[1]) {
    const dir: Dir = seg.t0 === t ? 1 : -1;
    Object.assign(ball, { segId: seg.id, dir, dist: dir === 1 ? s : len - s, leaving: undefined, bumped: false, crossLeft: 0 });
    events.push({ type: 'fall', from: here, to: q, k, front: fr, result: 'roll' });
    return;
  }
  const whole = Math.abs(s - Math.round(s)) < 1e-6;
  Object.assign(ball, { segId: seg.id, dir: 1, dist: whole ? Math.round(s) : s, mode: 'resting', leaving: whole ? key(pointAt(seg, 1, Math.round(s))) : undefined, bumped: false, crossLeft: 0 });
  events.push({ type: 'fall', from: here, to: q, k, front: fr, result: 'settle' });
}

/**
 * Is the ball in plain view in this world (nothing but its own track hiding any part of it)? Turning the
 * world to a view that would hide it is refused, like any other move that runs into something.
 */
export function inView(ball: BallState, world: JoinWorld): boolean {
  const seg = segById(world, ball.segId);
  const mine = new Set([seg.id]);
  for (const d of [1, -1] as const) {
    const e = exitOf(seg, d);
    const c = e.flag === 'open' ? findContinuation(world, e, seg) : null;
    if (c && c.k === 0) mine.add(c.seg.id);
  }
  const others = world.segments.filter((o) => !mine.has(o.id) && !(o.pieceId && world.moving.has(o.pieceId)));
  return hiding(drawnAt(ball, world), others, world.view, capsOf(world)) === null;
}

/** What happens at the end the ball is heading for, without moving it. */
export function upcoming(ball: BallState, world: JoinWorld): { remaining: number; flag: string; k: number | null } {
  const seg = segById(world, ball.segId);
  const exit = exitOf(seg, ball.dir);
  const c = exit.flag === 'open' ? findContinuation(world, exit, seg) : null;
  return { remaining: lengthOf(seg) - ball.dist, flag: c ? 'join' : exit.flag, k: c ? c.k : null };
}

export type Outcome = 'goal' | 'rest' | 'loop';

/** Momentum (GAME_PLAN §4.4c): gravity along the track, a gentle drive on level ground, lossy bounces. */
export const PHYS = {
  /** Gravity's pull along a slope, tiles/s² (softer than free fall: it's rolling, and it should feel calm). */
  gravity: 9,
  /** Speed the hook gives the ball, and the speed level ground eases toward. */
  cruise: 2,
  /** Speed limit on long drops, so it never races. */
  maxSpeed: 3.4,
  /** Fraction of speed kept by a bounce. */
  restitution: 0.45,
  /** Below this after a bounce on a slope, the ball settles where it is. */
  settle: 0.5,
};

/**
 * Advance the ball by `dt` seconds with momentum: it speeds up downhill, slows uphill and rolls back when
 * it runs out of speed, keeps a steady pace on level ground, and loses speed in every bounce. It eases
 * into the goal bowl and the start socket. Mutates `ball` (including `speed`).
 */
export function stepBall(ball: BallState, world: BallWorld, dt: number): BallEvent[] {
  if (ball.mode !== 'rolling') return [];
  const seg = segById(world, ball.segId);
  const len = lengthOf(seg);
  const ty = frameAt(seg, ball.dir, Math.min(ball.dist, len)).t[1];
  let v = ball.speed ?? PHYS.cruise;
  v -= PHYS.gravity * ty * dt;
  if (Math.abs(ty) < 0.05) v += (PHYS.cruise - v) * (1 - Math.exp(-2 * dt));
  // Ease into the bowl or back into the socket.
  const next = upcoming(ball, world);
  if (next.flag === 'goal' || next.flag === 'start') v = Math.min(v, PHYS.cruise * Math.max(0.25, next.remaining / 0.7));
  v = Math.min(v, PHYS.maxSpeed);
  if (v < 0) {
    // Gravity won: it rolls back the way it came.
    ball.turns = (ball.turns ?? 0) + 1;
    ball.dir = (-ball.dir) as Dir;
    ball.dist = len - ball.dist;
    v = -v;
    if (ball.turns > 6 && v < PHYS.settle) {
      ball.mode = 'resting';
      ball.speed = 0;
      return [{ type: 'rest', at: pointAt(seg, ball.dir, ball.dist), pad: true }];
    }
  }
  ball.speed = v;
  if (ball.crossLeft) ball.crossLeft = Math.max(0, ball.crossLeft - v * dt);
  const events = advance(ball, world, v * dt);
  for (const e of events) {
    if (e.type !== 'bump') continue;
    ball.speed = (ball.speed ?? 0) * PHYS.restitution;
    // Bounced off something on a slope with little speed left: it settles against it.
    const s2 = segById(world, ball.segId);
    const slope = Math.abs(frameAt(s2, ball.dir, Math.min(ball.dist, lengthOf(s2))).t[1]);
    if (slope > 0.3 && ball.speed < PHYS.settle) {
      ball.mode = 'resting';
      ball.speed = 0;
      events.push({ type: 'rest', at: e.at, pad: true });
    }
  }
  return events;
}

/** Release the ball and run until it reaches the goal, comes to rest, or is judged to loop forever. */
export function simulate(world: BallWorld, start: BallState): { outcome: Outcome; ball: BallState; events: BallEvent[] } {
  const ball: BallState = { ...start, mode: 'rolling', bumps: 0, bumped: false, turns: 0, speed: start.speed ?? PHYS.cruise };
  const events: BallEvent[] = [];
  const dt = 1 / 30;
  for (let i = 0; i < 6000; i++) {
    events.push(...stepBall(ball, world, dt));
    if (ball.mode === 'won') return { outcome: 'goal', ball, events };
    if (ball.mode === 'resting') return { outcome: 'rest', ball, events };
  }
  return { outcome: 'loop', ball, events };
}
