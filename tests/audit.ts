// Visual-physics audit: plays every ball run from every reachable state of a level, frame by frame,
// and reports each moment the ball overlaps a solid or is drawn hidden behind one. This is the
// "watch it like a player" check: it tests the exact triangles that are drawn, with no exemptions.
import { type BallEvent, type BallState, PHYS, drawnAt, inView, stepBall } from '../src/core/ball';
import { hiddenByTris, hiding, overlapping } from '../src/core/contact';
import { HOOK_STUB, hookParts, nubGeometry, pivotGeometry } from '../src/render/geometry';
import { pieceSegments } from '../src/core/level';
import { rot90 } from '../src/core/grid';
import { type BufferGeometry, Vector3 } from 'three';
import { VIEWS, type V3 } from '../src/core/grid';
import { capsShown, findContinuation } from '../src/core/joins';
import { type LevelDef, type PieceStates, initialStates, startSegment } from '../src/core/level';
import { type Move, worldFor } from '../src/core/solver';
import { Solidity } from '../src/core/solidity';
import { type Segment, exitOf, frameAt, lengthOf, pointAt } from '../src/core/track';

export interface Violation {
  kind: 'overlap' | 'hidden';
  /** What the ball went into or behind. */
  seg: string;
  /** Where the ball was: on a segment, or falling. */
  ballOn: string;
  at: number[];
  path: string;
}

const GRAVITY = 22;
const DT = 1 / 60;

const say = (m: Move) =>
  m.type === 'slide' ? `${m.piece}→${m.to}` : m.type === 'rotate' ? `${m.piece}↻${m.to}` : m.type === 'view' ? `view${m.to}` : 'go';

/** Frames of a fall as the game animates it (straight down the screen, at the landing's depth). */
function fallFrames(ev: Extract<BallEvent, { type: 'fall' }>, exitT: V3, speed: number, view: number): number[][] {
  const v = VIEWS[view];
  const pos = [0, 1, 2].map((i) => ev.from[i] + v[i] * ev.k);
  const lift = (p: number[]) => p.map((x, i) => x + v[i] * ev.front);
  const to = ev.to;
  const s = Math.max(speed, 0.8);
  const vel = [exitT[0] * s, exitT[1] * s, exitT[2] * s];
  if (ev.result !== 'lost') {
    const h = pos[1] - to[1], vy = vel[1];
    const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(h, 0.05))) / GRAVITY;
    vel[0] = (to[0] - pos[0]) / t;
    vel[2] = (to[2] - pos[2]) / t;
  }
  const out: number[][] = [];
  // Lost balls are checked until they have mostly faded (0.35 s solid, then fading out by 0.9 s).
  for (let t = 0; t < 0.6; t += DT) {
    vel[1] -= GRAVITY * DT;
    for (let i = 0; i < 3; i++) pos[i] += vel[i] * DT;
    if (ev.result !== 'lost' && pos[1] <= to[1]) break;
    out.push(lift(pos));
  }
  return out;
}

/** A geometry's triangles as a flat world-space soup, after `map` moves each vertex. */
function soupOf(g: BufferGeometry, map: (p: [number, number, number]) => [number, number, number] = (p) => p): Float64Array {
  const pos = g.getAttribute('position'), idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const soup = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = idx ? idx.getX(i) : i;
    soup.set(map([pos.getX(j), pos.getY(j), pos.getZ(j)]), i * 3);
  }
  return soup;
}

/** The start gate's post and bar, with `bar` of the bar showing (1 = closed across the track), as drawn. */
export function hookSoups(level: LevelDef, bar: number): Float64Array[] {
  const h = hookParts(startSegment(level), VIEWS[level.startView]);
  const post = soupOf(h.post, ([x, y, z]) => [x + h.postAt.x, y + h.postAt.y, z + h.postAt.z]);
  const arm = soupOf(h.arm, (p) => {
    const v = new Vector3(p[0], p[1], p[2] * bar).applyQuaternion(h.orient).add(h.pivot);
    return [v.x, v.y, v.z];
  });
  return [post, arm];
}

/** World-space triangles of a piece's knobs and handles, as drawn (they're built once, facing the start view). */
function decorations(level: LevelDef, states: PieceStates): Float64Array[] {
  const v0 = VIEWS[level.startView];
  const out: Float64Array[] = [];
  for (const def of level.pieces) {
    const geos: BufferGeometry[] = [];
    if (def.slide && def.shape === 'beam') geos.push(nubGeometry(pieceSegments(def)[0], v0));
    if (def.rotate) geos.push(pivotGeometry(def.rotate.pivot as V3));
    const st = states[def.id];
    for (const g of geos) {
      out.push(soupOf(g, (p) => {
        if (def.rotate) {
          // Quarter turns about the pivot (rot90 on the offset, fractional coordinates are fine).
          const pv = def.rotate.pivot;
          const r = rot90([p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]], def.rotate.axis, st.r);
          p = [r[0] + pv[0], r[1] + pv[1], r[2] + pv[2]];
        }
        if (def.slide) { const a = def.slide.axis === 'x' ? 0 : def.slide.axis === 'y' ? 1 : 2; p[a] += st.s; }
        return p;
      }));
    }
  }
  // Once the ball is rolling the start gate is open (tests/hook.test.ts checks it closed and while it swings).
  return [...out, ...hookSoups(level, HOOK_STUB)];
}

/** Play one release from `start` and return the first violation, if any. */
export function auditRun(level: LevelDef, states: PieceStates, view: number, start: BallState): Omit<Violation, 'path'> | null {
  const world = worldFor(level, states, view);
  const caps = capsShown(world);
  const segs = world.segments;
  const decor = decorations(level, states);
  const ball: BallState = { ...start, mode: 'rolling', bumps: 0, bumped: false, turns: 0, speed: PHYS.cruise };
  const check = (truePos: readonly number[], shown: readonly number[], on: string, own: Segment | null) => {
    // Its own riding surface is touched at exactly BALL_R, which `overlapping` allows.
    const o = overlapping(truePos, segs, caps);
    if (o) return { kind: 'overlap' as const, seg: o.id, ballOn: on, at: truePos.map((x) => +x.toFixed(2)) };
    // Only its own track, and track physically joined to it, may hide it (going round the back of a pillar).
    const mine = new Set(own ? [own.id] : []);
    if (own) for (const d of [1, -1] as const) {
      const e = exitOf(own, d);
      const c = e.flag === 'open' ? findContinuation(world, e, own) : null;
      if (c && c.k === 0) mine.add(c.seg.id);
    }
    const h = hiding(shown, segs.filter((s) => !mine.has(s.id)), view, caps);
    if (h) return { kind: 'hidden' as const, seg: h.id, ballOn: on, at: truePos.map((x) => +x.toFixed(2)) };
    if (hiddenByTris(shown, decor, view)) return { kind: 'hidden' as const, seg: 'a knob or handle', ballOn: on, at: truePos.map((x) => +x.toFixed(2)) };
    return null;
  };
  for (let i = 0; i < 4000; i++) {
    const seg = segs.find((s) => s.id === ball.segId)!;
    const r = check(pointAt(seg, ball.dir, Math.min(ball.dist, lengthOf(seg))), drawnAt(ball, world), seg.id, seg);
    if (r) return r;
    if (ball.mode !== 'rolling') return null;
    const exitT = frameAt(seg, ball.dir, lengthOf(seg)).t;
    const speed = ball.speed ?? PHYS.cruise;
    for (const ev of stepBall(ball, world, DT)) {
      if (ev.type !== 'fall') continue;
      for (const p of fallFrames(ev, exitT, speed, view)) {
        const f = check(p, p, 'falling', null);
        if (f) return f;
      }
    }
  }
  return null;
}

/** Every reachable state (like the solver, but exhaustive), each release audited. */
export function auditLevel(level: LevelDef, maxNodes = 3000): { violations: Violation[]; runs: number } {
  const solid = new Solidity(level);
  const startBall: BallState = { segId: startSegment(level).id, dir: 1, dist: 0, mode: 'resting' };
  type Node = { states: PieceStates; view: number; ball: BallState; path: Move[] };
  const key = (n: Node) => `${JSON.stringify(n.states)}|${n.view}|${n.ball.segId}:${n.ball.dir}:${n.ball.dist.toFixed(3)}`;
  const queue: Node[] = [{ states: initialStates(level), view: level.startView, ball: startBall, path: [] }];
  const seen = new Set([key(queue[0])]);
  const violations: Violation[] = [];
  const reported = new Set<string>();
  let runs = 0;
  while (queue.length && runs < maxNodes) {
    const node = queue.shift()!;
    runs++;
    const world = worldFor(level, node.states, node.view);
    const r = auditRun(level, node.states, node.view, node.ball);
    if (r) {
      const sig = `${r.kind}|${r.seg}|${r.ballOn}|${JSON.stringify(node.states)}|${node.view}`;
      if (!reported.has(sig)) { reported.add(sig); violations.push({ ...r, path: [...node.path, { type: 'release' } as Move].map(say).join(' ') }); }
    }
    const next: [Move, Node][] = [];
    const ballSeg = world.segments.find((s) => s.id === node.ball.segId)!;
    const ballAt = pointAt(ballSeg, node.ball.dir, node.ball.dist);
    for (const p of level.pieces) {
      if (ballSeg.pieceId === p.id) continue;
      const st = node.states[p.id];
      if (p.slide) for (const s of p.slide.stops) {
        if (s === st.s || !solid.canMove(p.id, st, { ...st, s }, node.states, ballAt, node.view)) continue;
        next.push([{ type: 'slide', piece: p.id, to: s }, { ...node, states: { ...node.states, [p.id]: { ...st, s } } }]);
      }
      if (p.rotate && solid.canMove(p.id, st, { ...st, r: st.r + 1 }, node.states, ballAt, node.view)) {
        next.push([{ type: 'rotate', piece: p.id, to: (st.r + 1) % 4 }, { ...node, states: { ...node.states, [p.id]: { ...st, r: (st.r + 1) % 4 } } }]);
      }
    }
    if (level.views.length > 1) for (const to of level.views) {
      if (to !== node.view && inView(node.ball, worldFor(level, node.states, to))) next.push([{ type: 'view', to }, { ...node, view: to }]);
    }
    // Where the ball comes to rest after this release (if it doesn't win), for further moves from there.
    const b: BallState = { ...node.ball, mode: 'rolling', bumps: 0, bumped: false, turns: 0, speed: PHYS.cruise };
    for (let i = 0; i < 6000 && b.mode === 'rolling'; i++) stepBall(b, world, 1 / 30);
    if (b.mode === 'resting') next.push([{ type: 'release' }, { ...node, ball: { segId: b.segId, dir: b.dir, dist: b.dist, mode: 'resting', leaving: b.leaving } }]);
    for (const [m, n] of next) {
      const k = key(n);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ ...n, path: [...node.path, m] });
    }
  }
  return { violations, runs };
}

export const describeViolation = (v: Violation) =>
  `${v.kind === 'overlap' ? 'ball INSIDE' : 'ball HIDDEN behind'} ${v.seg} while ${v.ballOn === 'falling' ? 'falling' : `on ${v.ballOn}`} at (${v.at.join(', ')})  after: ${v.path}`;

