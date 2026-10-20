// Procedural meshes for each piece family (GAME_PLAN §8). Everything is built from the track data.
import * as THREE from 'three';
import { AXES, type V3, cross } from '../core/grid';
import { type EndFlag, type Segment, lengthOf, tangentOf } from '../core/track';

/** Ball radius and beam cross-section (world units). */
export const BALL_R = 0.28;
export const BEAM_W = 0.9;
export const BEAM_D = 0.6;
/** Beams extend past non-joinable ends so the ball sits on solid track; open ends stop exactly at the endpoint. */
const END_EXT: Record<EndFlag, number> = { open: 0, cap: 0.5, start: 0.5, goal: 0.55, drop: 0 };

const v = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

export interface SegmentFrame {
  t: THREE.Vector3; n: THREE.Vector3; w: THREE.Vector3; from: THREE.Vector3; len: number;
}

export function frameOf(seg: Segment): SegmentFrame {
  const t = AXES[tangentOf(seg)];
  const n = AXES[seg.n];
  return { t: v(t), n: v(n), w: v(cross(t, n)), from: v(seg.from), len: lengthOf(seg) };
}

/** Build a quad, flipping winding so it faces `outward`. */
function pushQuad(pos: number[], nor: number[], uv: number[], c: THREE.Vector3[], outward: THREE.Vector3) {
  const e1 = c[1].clone().sub(c[0]);
  const e2 = c[2].clone().sub(c[0]);
  const order = e1.cross(e2).dot(outward) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const i of order) {
    pos.push(c[i].x, c[i].y, c[i].z);
    nor.push(outward.x, outward.y, outward.z);
    uv.push(uvs[i][0], uvs[i][1]);
  }
}

function geometryFrom(pos: number[], nor: number[], uv: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export interface BeamGeometry {
  body: THREE.BufferGeometry;
  /** End faces, kept separate so they can be hidden while that end is joined (seamless on screen). */
  caps: [THREE.BufferGeometry, THREE.BufferGeometry];
}

/** A straight beam under the ball path: surface at −R along n, depth D, width W. */
export function beamGeometry(seg: Segment, extra = 0): BeamGeometry {
  const f = frameOf(seg);
  const a = -END_EXT[seg.ends[0]] - extra;
  const b = f.len + END_EXT[seg.ends[1]] + extra;
  const hw = BEAM_W / 2 + extra;
  const n0 = -BALL_R + extra, n1 = -BALL_R - BEAM_D - extra;
  const P = (tv: number, nv: number, wv: number) =>
    f.from.clone().addScaledVector(f.t, tv).addScaledVector(f.n, nv).addScaledVector(f.w, wv);

  const body = { pos: [] as number[], nor: [] as number[], uv: [] as number[] };
  const q = (c: THREE.Vector3[], out: THREE.Vector3) => pushQuad(body.pos, body.nor, body.uv, c, out);
  q([P(a, n0, -hw), P(b, n0, -hw), P(b, n0, hw), P(a, n0, hw)], f.n);
  q([P(a, n1, -hw), P(b, n1, -hw), P(b, n1, hw), P(a, n1, hw)], f.n.clone().negate());
  q([P(a, n0, hw), P(b, n0, hw), P(b, n1, hw), P(a, n1, hw)], f.w);
  q([P(a, n0, -hw), P(b, n0, -hw), P(b, n1, -hw), P(a, n1, -hw)], f.w.clone().negate());

  const cap = (tv: number, out: THREE.Vector3) => {
    const c = { pos: [] as number[], nor: [] as number[], uv: [] as number[] };
    pushQuad(c.pos, c.nor, c.uv, [P(tv, n0, -hw), P(tv, n0, hw), P(tv, n1, hw), P(tv, n1, -hw)], out);
    return geometryFrom(c.pos, c.nor, c.uv);
  };
  return {
    body: geometryFrom(body.pos, body.nor, body.uv),
    caps: [cap(a, f.t.clone().negate()), cap(b, f.t)],
  };
}

/**
 * Glow quad covering a beam's cross-section at distance `at` along it.
 * uv.y = 1 at the riding surface; uv.x runs across the width (0 at −w, 1 at +w).
 */
export function seamGeometry(seg: Segment, at: number) {
  const f = frameOf(seg);
  const pad = 0.04;
  const hw = BEAM_W / 2 + pad;
  const n0 = -BALL_R + pad, n1 = -BALL_R - BEAM_D - pad;
  const P = (nv: number, wv: number) => f.from.clone().addScaledVector(f.t, at).addScaledVector(f.n, nv).addScaledVector(f.w, wv);
  const c = [P(n1, -hw), P(n1, hw), P(n0, hw), P(n0, -hw)];
  const pos: number[] = [], uv: number[] = [];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(c[i].x, c[i].y, c[i].z); uv.push(uvs[i][0], uvs[i][1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { geometry: g, w: f.w, aspect: (BEAM_W + 2 * pad) / (BEAM_D + 2 * pad) };
}

/** Rounded handle nub on the camera-facing side of a movable piece. */
export function nubGeometry(seg: Segment, side: 1 | -1) {
  const f = frameOf(seg);
  const g = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 20);
  // Cylinder axis is +y; turn it to point along ±w.
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.w.clone().multiplyScalar(side)));
  const c = f.from.clone().addScaledVector(f.t, f.len / 2).addScaledVector(f.n, -BALL_R - BEAM_D / 2)
    .addScaledVector(f.w, side * (BEAM_W / 2 + 0.03));
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Start hook: a post beside the start with an arm across the track that swings up on release. */
export function hookParts(seg: Segment, side: 1 | -1) {
  const f = frameOf(seg);
  const base = f.from.clone().addScaledVector(f.t, 0.42).addScaledVector(f.n, -BALL_R).addScaledVector(f.w, side * (BEAM_W / 2 - 0.08));
  const postH = BALL_R * 2 + 0.12;
  const post = new THREE.BoxGeometry(0.12, postH, 0.12);
  post.translate(0, postH / 2, 0);
  const armLen = BEAM_W - 0.12;
  const arm = new THREE.BoxGeometry(0.09, 0.09, armLen);
  arm.translate(0, 0, -side * armLen / 2);
  // Orient the local frame (x = t, y = n, z = w) into world space.
  const basis = new THREE.Matrix4().makeBasis(f.t, f.n, f.w);
  post.applyMatrix4(basis);
  arm.applyMatrix4(basis);
  const pivot = base.clone().addScaledVector(f.n, postH - 0.06);
  return { post, postAt: base, arm, pivot, hingeAxis: f.t.clone() };
}

/** Shallow chime bowl sitting on the surface at the goal end. */
export function bowlParts(at: V3, n: THREE.Vector3) {
  const prof = [[0, 0.03], [0.28, 0.03], [0.4, 0.1], [0.43, 0.15], [0.38, 0.14], [0.3, 0.08], [0.0, 0.06]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const bowl = new THREE.LatheGeometry(prof, 40);
  const rim = new THREE.TorusGeometry(0.405, 0.028, 10, 48);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.148, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const surface = v(at).addScaledVector(n, -BALL_R);
  for (const g of [bowl, rim]) { g.applyQuaternion(q); g.translate(surface.x, surface.y, surface.z); }
  return { bowl, rim, surface };
}
