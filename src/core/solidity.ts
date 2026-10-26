// Which piece positions and moves are physically possible in a level (used by the game, the solver and tests).
import { type Samples, hitsBall, moveSamples, overlaps, sampleSegment } from './collision';
import { hiding } from './contact';
import { type V3, VIEWS, scale, viewMultiple } from './grid';
import { type LevelDef, type PieceDef, type PieceState, type PieceStates, initialStates, pieceSegments, placementOf, resolveSegments, slideVector } from './level';
import { place } from './track';

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

  /**
   * Is piece `id` free at `pose`, given the other pieces' states and (optionally) the ball? With a `view`,
   * the piece also may not be drawn over the ball: what looks solid is solid, so sliding a piece across the
   * ball on screen is a collision too.
   */
  free(id: string, pose: Pose, others: PieceStates, ball?: V3, view?: number): boolean {
    const key = `${id}|${pose.s.toFixed(3)}|${pose.q.toFixed(3)}|${JSON.stringify(others)}|${ball ? ball.map((v) => v.toFixed(2)).join(',') : ''}|${view ?? ''}`;
    const hit = this.freeCache.get(key);
    if (hit !== undefined) return hit;
    const r = this.check(id, pose, others, ball) && (ball === undefined || view === undefined || !this.covers(id, pose, ball, view));
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

  /** Is piece `id` at `pose` drawn over the resting ball? (Checked at whole quarter turns while rotating.) */
  private covers(id: string, pose: Pose, ball: V3, view: number): boolean {
    if (Math.abs(pose.q - Math.round(pose.q)) > 1e-6) return false;
    const p = this.defs.get(id)!;
    const pl = placementOf(p, { s: pose.s, r: ((Math.round(pose.q) % 4) + 4) % 4 });
    const v = VIEWS[view], l = Math.hypot(v[0], v[1], v[2]);
    const segs = pieceSegments(p).map((s) => place(s, pl));
    // Arriving at a seam with the ball (an end of the piece meets the ball's point on screen, nearer the
    // camera), the ball is drawn at the piece's depth, as it will be once joined: it sits on the piece.
    const snapped = pieceSegments(p).map((s) => place(s, placementOf(p, { s: Math.round(pose.s), r: ((Math.round(pose.q) % 4) + 4) % 4 })));
    const at = ball.map((x) => Math.round(x * 1e6) / 1e6) as unknown as V3;
    let m = 0;
    for (const s of snapped) for (const e of [s.from, s.to]) {
      const k = viewMultiple([e[0] - at[0], e[1] - at[1], e[2] - at[2]], v);
      if (k !== null && k > m) m = k;
    }
    const lift = m + 0.5 / l;
    const shown: V3 = [ball[0] + v[0] * lift, ball[1] + v[1] * lift, ball[2] + v[2] * lift];
    return hiding(shown, segs, view, () => true) !== null;
  }

  /** Can piece `id` move from its current state to `to`, sweeping through every pose in between? */
  canMove(id: string, from: PieceState, to: PieceState, states: PieceStates, ball?: V3, view?: number): boolean {
    const ds = to.s - from.s;
    let dq = ((to.r - from.r) % 4 + 4) % 4;
    if (dq > 2) dq -= 4;
    const steps = Math.max(1, Math.ceil(Math.abs(ds) / 0.2), Math.ceil(Math.abs(dq) * 6));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      if (!this.free(id, { s: from.s + ds * f, q: from.r + dq * f }, states, ball, view)) return false;
    }
    return true;
  }

  /** The continuous slide range reachable from `s` without hitting anything (for clamping drags). */
  slideRange(id: string, st: PieceState, states: PieceStates, ball?: V3, view?: number): [number, number] {
    const p = this.defs.get(id)!;
    if (!p.slide) return [st.s, st.s];
    const lo = Math.min(...p.slide.stops), hi = Math.max(...p.slide.stops);
    const scan = (dir: 1 | -1) => {
      let v = st.s;
      while (true) {
        const next = v + dir * 0.05;
        if (dir === 1 ? next > hi : next < lo) return dir === 1 ? hi : lo;
        if (!this.free(id, { s: next, q: st.r }, states, ball, view)) return v;
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
