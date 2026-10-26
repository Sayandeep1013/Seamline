// Breadth-first solver over (piece states, view, ball rest position) — GAME_PLAN §9.4.
// A move is one drag to any stop, one 90° rotation, one view turn, or one release.
import { type BallState, type BallWorld, inView, simulate } from './ball';
import { type LevelDef, type PieceStates, initialStates, padKeys, resolveSegments, startSegment } from './level';
import { Solidity } from './solidity';
import { pointAt } from './track';

export type Move =
  | { type: 'slide'; piece: string; to: number }
  | { type: 'rotate'; piece: string; to: number }
  | { type: 'view'; to: number }
  | { type: 'release' };

interface Node {
  states: PieceStates;
  view: number;
  ball: BallState;
  path: Move[];
}

const stateKey = (n: Pick<Node, 'states' | 'view' | 'ball'>) =>
  `${JSON.stringify(n.states)}|${n.view}|${n.ball.segId}:${n.ball.dir}:${n.ball.dist}`;

export function worldFor(level: LevelDef, states: PieceStates, view: number): BallWorld {
  return {
    segments: resolveSegments(level, states), view, moving: new Set(), pads: padKeys(level),
    startSeg: startSegment(level).id,
  };
}

export interface SolveResult {
  solvable: boolean;
  /** Player-facing par: every move except the first release. */
  par: number;
  solution: Move[];
  explored: number;
}

export function solve(level: LevelDef, opts: { from?: Omit<Node, 'path'>; maxNodes?: number } = {}): SolveResult {
  const start: Node = opts.from
    ? { ...opts.from, path: [] }
    : {
      states: initialStates(level),
      view: level.startView,
      ball: { segId: startSegment(level).id, dir: 1, dist: 0, mode: 'resting' },
      path: [],
    };
  const solid = new Solidity(level);
  const seen = new Set([stateKey(start)]);
  const queue: Node[] = [start];
  const max = opts.maxNodes ?? 200000;
  let explored = 0;

  while (queue.length && explored < max) {
    const node = queue.shift()!;
    explored++;
    const next: [Move, Omit<Node, 'path'>][] = [];

    // Pieces are solid: a move is allowed only if the whole sweep stays clear of track, pieces and the ball.
    const world = worldFor(level, node.states, node.view);
    const ballSeg = world.segments.find((sg) => sg.id === node.ball.segId)!;
    const ballAt = pointAt(ballSeg, node.ball.dir, node.ball.dist);
    for (const p of level.pieces) {
      if (ballSeg.pieceId === p.id) continue; // the ball is resting on it
      const st = node.states[p.id];
      if (p.slide) for (const s of p.slide.stops) {
        if (s === st.s || !solid.canMove(p.id, st, { ...st, s }, node.states, ballAt, node.view)) continue;
        next.push([{ type: 'slide', piece: p.id, to: s }, { ...node, states: { ...node.states, [p.id]: { ...st, s } } }]);
      }
      if (p.rotate) {
        const r = (st.r + 1) % 4;
        if (solid.canMove(p.id, st, { ...st, r: st.r + 1 }, node.states, ballAt, node.view)) {
          next.push([{ type: 'rotate', piece: p.id, to: r }, { ...node, states: { ...node.states, [p.id]: { ...st, r } } }]);
        }
      }
    }
    if (level.views.length > 1) {
      const i = level.views.indexOf(node.view);
      for (const j of [i - 1, i + 1]) {
        const to = level.views[(j + level.views.length) % level.views.length];
        if (to !== node.view && inView(node.ball, worldFor(level, node.states, to))) next.push([{ type: 'view', to }, { ...node, view: to }]);
      }
    }
    const run = simulate(world, node.ball);
    if (run.outcome === 'goal') {
      const solution = [...node.path, { type: 'release' } as Move];
      return { solvable: true, par: solution.length - 1, solution, explored };
    }
    if (run.outcome === 'rest') {
      next.push([{ type: 'release' }, { ...node, ball: { ...run.ball, mode: 'resting' } }]);
    }

    for (const [move, n] of next) {
      const k = stateKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ ...n, path: [...node.path, move] });
    }
  }
  return { solvable: false, par: -1, solution: [], explored };
}

export function describe(m: Move): string {
  switch (m.type) {
    case 'slide': return `slide ${m.piece} → ${m.to}`;
    case 'rotate': return `rotate ${m.piece} → ${m.to}`;
    case 'view': return `turn to view ${m.to}`;
    case 'release': return 'release';
  }
}
