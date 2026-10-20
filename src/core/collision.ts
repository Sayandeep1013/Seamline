// Solidity: pieces may never pass through track, other pieces or the ball (GAME_PLAN §4.8).
// Each segment is approximated by samples along its path: the ball corridor (the path itself)
// and the slab centre under it. Two things collide when any of those samples come too close.
import type { V3 } from './grid';
import { type Segment, depthOf, frameAt, lengthOf } from './track';

/** Mirrors render/geometry.ts: ball radius 0.28 above the surface, then the slab's depth below it. */
const BALL_R = 0.28;
const STEP = 0.25;
/** Minimum distance between samples of two different solids. */
export const CLEAR = 0.55;
/** Samples this close to an end shared by two segments are ignored (they are meant to touch there). */
const SHARED_END = 0.8;

type P = [number, number, number];

export interface Samples {
  owner: string;
  /** Ball-corridor points and slab-centre points. */
  pts: P[];
  /** Path point each sample came from (for the shared-end exclusion). */
  path: P[];
  ends: [P, P];
  /** Axis-aligned bounds of the samples, padded by CLEAR, for quick rejection. */
  min: P; max: P;
}

function bounds(pts: P[]): { min: P; max: P } {
  const min: P = [Infinity, Infinity, Infinity], max: P = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k] - CLEAR); max[k] = Math.max(max[k], p[k] + CLEAR); }
  return { min, max };
}

const apart = (a: Samples, b: Samples) =>
  a.max[0] < b.min[0] + CLEAR || b.max[0] < a.min[0] + CLEAR ||
  a.max[1] < b.min[1] + CLEAR || b.max[1] < a.min[1] + CLEAR ||
  a.max[2] < b.min[2] + CLEAR || b.max[2] < a.min[2] + CLEAR;

export function sampleSegment(seg: Segment): Samples {
  const len = lengthOf(seg);
  const n = Math.max(2, Math.ceil(len / STEP));
  const pts: P[] = [], path: P[] = [];
  const c = BALL_R + depthOf(seg) / 2;
  for (let i = 0; i <= n; i++) {
    const f = frameAt(seg, 1, (len * i) / n);
    const p = [...f.p] as P;
    pts.push(p, [p[0] - f.n[0] * c, p[1] - f.n[1] * c, p[2] - f.n[2] * c]);
    path.push(p, p);
  }
  return { owner: seg.pieceId ?? `fixed:${seg.id}`, pts, path, ends: [[...seg.from] as P, [...seg.to] as P], ...bounds(pts) };
}

const d2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const same = (a: readonly number[], b: readonly number[]) => d2(a, b) < 1e-6;

/** Do two sampled segments overlap (ignoring the neighbourhood of an end they share)? */
export function overlaps(a: Samples, b: Samples): boolean {
  if (apart(a, b)) return false;
  const shared = a.ends.filter((e) => b.ends.some((f) => same(e, f)));
  const c2 = CLEAR * CLEAR, s2 = SHARED_END * SHARED_END;
  for (let i = 0; i < a.pts.length; i++) {
    if (shared.some((e) => d2(a.path[i], e) < s2)) continue;
    for (let j = 0; j < b.pts.length; j++) {
      if (d2(a.pts[i], b.pts[j]) >= c2) continue;
      if (shared.some((e) => d2(b.path[j], e) < s2)) continue;
      return true;
    }
  }
  return false;
}

/** Does a solid overlap the ball, sitting at `ball`? */
export function hitsBall(a: Samples, ball: V3): boolean {
  for (let k = 0; k < 3; k++) if (ball[k] < a.min[k] || ball[k] > a.max[k]) return false;
  const c2 = CLEAR * CLEAR;
  return a.pts.some((p) => d2(p, ball) < c2);
}

/** Rigid transform of samples: rotate by `angle` radians about `axis` through `pivot`, then offset. */
export function moveSamples(s: Samples, offset: V3, rot?: { axis: 'x' | 'y' | 'z'; pivot: V3; angle: number }): Samples {
  const tf = (p: P): P => {
    let [x, y, z] = p;
    if (rot) {
      const c = Math.cos(rot.angle), sn = Math.sin(rot.angle);
      x -= rot.pivot[0]; y -= rot.pivot[1]; z -= rot.pivot[2];
      if (rot.axis === 'x') [y, z] = [y * c - z * sn, y * sn + z * c];
      else if (rot.axis === 'y') [x, z] = [x * c + z * sn, -x * sn + z * c];
      else [x, y] = [x * c - y * sn, x * sn + y * c];
      x += rot.pivot[0]; y += rot.pivot[1]; z += rot.pivot[2];
    }
    return [x + offset[0], y + offset[1], z + offset[2]];
  };
  const pts = s.pts.map(tf);
  return { owner: s.owner, pts, path: s.path.map(tf), ends: [tf(s.ends[0]), tf(s.ends[1])], ...bounds(pts) };
}
