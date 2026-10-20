// Which piece positions and moves are physically possible in a level (used by the game, the solver and tests).
import { type Samples, hitsBall, moveSamples, overlaps, sampleSegment } from './collision';
import { type V3, scale } from './grid';
import { type LevelDef, type PieceDef, type PieceState, type PieceStates, initialStates, pieceSegments, resolveSegments, slideVector } from './level';

/** One continuous pose of a piece: slide value and rotation in quarter turns (both may be fractional). */
export interface Pose { s: number; q: number }

export class Solidity {
  private fixed: Samples[];
  private base = new Map<string, Samples[]>();
  private defs = new Map<string, PieceDef>();
  private poseCache = new Map<string, Samples[]>();
  private freeCache = new Map<string, boolean>();

  constructor(private level: LevelDef) {
    this.fixed = resolveSegments(level, initialStates(level)).filter((s) => s.pieceId === null).map(sampleSegment);
    for (const p of level.pieces) {
      this.defs.set(p.id, p);
      this.base.set(p.id, pieceSegments(p).map(sampleSegment));
    }
  }

  /** Samples of a piece at a continuous pose. */
  at(id: string, pose: Pose): Samples[] {
    const key = `${id}|${pose.s.toFixed(3)}|${pose.q.toFixed(3)}`;
    const hit = this.poseCache.get(key);
    if (hit) return hit;
    const out = this.compute(id, pose);
    if (this.poseCache.size > 5000) this.poseCache.clear();
    this.poseCache.set(key, out);
    return out;
  }

  private compute(id: string, pose: Pose): Samples[] {
    const p = this.defs.get(id)!;
    const offset: V3 = p.slide ? scale(slideVector(p.slide), pose.s) : [0, 0, 0];
    const rot = p.rotate ? { axis: p.rotate.axis, pivot: p.rotate.pivot as V3, angle: (pose.q * Math.PI) / 2 } : undefined;
    return this.base.get(id)!.map((s) => moveSamples(s, offset, rot));
  }

  /** Is piece `id` free at `pose`, given the other pieces' states and (optionally) the ball? */
  free(id: string, pose: Pose, others: PieceStates, ball?: V3): boolean {
    const key = `${id}|${pose.s.toFixed(3)}|${pose.q.toFixed(3)}|${JSON.stringify(others)}|${ball ? ball.map((v) => v.toFixed(2)).join(',') : ''}`;
    const hit = this.freeCache.get(key);
    if (hit !== undefined) return hit;
    const r = this.check(id, pose, others, ball);
    if (this.freeCache.size > 20000) this.freeCache.clear();
    this.freeCache.set(key, r);
    return r;
  }

  private check(id: string, pose: Pose, others: PieceStates, ball?: V3): boolean {
    const mine = this.at(id, pose);
    for (const m of mine) {
      if (this.fixed.some((f) => overlaps(m, f))) return false;
      if (ball && hitsBall(m, ball)) return false;
    }
    for (const [oid, st] of Object.entries(others)) {
      if (oid === id) continue;
      const theirs = this.at(oid, { s: st.s, q: st.r });
      if (mine.some((m) => theirs.some((t) => overlaps(m, t)))) return false;
    }
    return true;
  }

  /** Can piece `id` move from its current state to `to`, sweeping through every pose in between? */
  canMove(id: string, from: PieceState, to: PieceState, states: PieceStates, ball?: V3): boolean {
    const ds = to.s - from.s;
    let dq = ((to.r - from.r) % 4 + 4) % 4;
    if (dq > 2) dq -= 4;
    const steps = Math.max(1, Math.ceil(Math.abs(ds) / 0.2), Math.ceil(Math.abs(dq) * 6));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      if (!this.free(id, { s: from.s + ds * f, q: from.r + dq * f }, states, ball)) return false;
    }
    return true;
  }

  /** The continuous slide range reachable from `s` without hitting anything (for clamping drags). */
  slideRange(id: string, st: PieceState, states: PieceStates, ball?: V3): [number, number] {
    const p = this.defs.get(id)!;
    if (!p.slide) return [st.s, st.s];
    const lo = Math.min(...p.slide.stops), hi = Math.max(...p.slide.stops);
    const scan = (dir: 1 | -1) => {
      let v = st.s;
      while (true) {
        const next = v + dir * 0.05;
        if (dir === 1 ? next > hi : next < lo) return dir === 1 ? hi : lo;
        if (!this.free(id, { s: next, q: st.r }, states, ball)) return v;
        v = next;
      }
    };
    return [scan(-1), scan(1)];
  }

  /** Every piece clear of the fixed track and of each other in these states. */
  legal(states: PieceStates, ball?: V3): boolean {
    return this.level.pieces.every((p) => this.free(p.id, { s: states[p.id].s, q: states[p.id].r }, states, ball));
  }
}
