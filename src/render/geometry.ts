// Procedural meshes for each piece family (GAME_PLAN §8). Everything is swept along the track data.
import * as THREE from 'three';
import type { V3 } from '../core/grid';
import { type EndFlag, type Segment, depthAlong, frameAt, lengthOf } from '../core/track';

/** Ball radius and beam cross-section (world units). */
export const BALL_R = 0.28;
export const BEAM_W = 0.9;
export const BEAM_D = 0.6;
/** Beams extend past non-joinable ends so the ball sits on solid track; open ends stop exactly at the endpoint. */
const END_EXT: Record<EndFlag, number> = { open: 0, cap: 0.5, start: 0.5, goal: 0.55, drop: 0 };

const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

interface Sample { p: THREE.Vector3; t: THREE.Vector3; n: THREE.Vector3; w: THREE.Vector3; d?: number }
/** Marker for "this sample's bottom depth" in trackGeometry. */
const BOTTOM = Number.NEGATIVE_INFINITY;

/** Frames along the ball path, sampled densely on curves; straights get their end extensions. */
function samples(seg: Segment, extra = 0): Sample[] {
  const out: Sample[] = [];
  const len = lengthOf(seg);
  const steps = seg.kind === 'straight' ? 1 : 14;
  for (let i = 0; i <= steps; i++) {
    const f = frameAt(seg, 1, (len * i) / steps);
    const t = vec(f.t).normalize(), n = vec(f.n).normalize();
    out.push({ p: vec(f.p), t, n, w: new THREE.Vector3().crossVectors(t, n) });
  }
  if (seg.kind === 'straight') {
    const e0 = END_EXT[seg.ends[0]] + extra, e1 = END_EXT[seg.ends[1]] + extra;
    out[0].p.addScaledVector(out[0].t, -e0);
    out[out.length - 1].p.addScaledVector(out[out.length - 1].t, e1);
  }
  return out;
}

type F2 = [number, number];

class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; face: number[] = [];
  /** `f` gives each corner's (across, down) shading coordinates: see aFace in the tone shader. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
    na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, nd: THREE.Vector3,
    f: [F2, F2, F2, F2] = [[0, 0], [0, 0], [0, 0], [0, 0]]) {
    // Keep the winding consistent with the outward normal.
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const flip = n.dot(new THREE.Vector3().add(na).add(nc)) < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    const P = [a, b, c, d], N = [na, nb, nc, nd];
    for (const i of order) {
      this.pos.push(P[i].x, P[i].y, P[i].z);
      this.nor.push(N[i].x, N[i].y, N[i].z);
      this.uv.push(0, 0);
      this.face.push(f[i][0], f[i][1]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(this.face, 2));
    return g;
  }
}

export interface TrackGeometry {
  body: THREE.BufferGeometry;
  /** End faces, kept separate so they can be hidden while that end is joined (seamless on screen). */
  caps: [THREE.BufferGeometry, THREE.BufferGeometry];
}

/** Solid slab under the ball path: riding surface at −R along n, depth D, width W. Works for every segment kind. */
export function trackGeometry(seg: Segment, extra = 0, depth: number | ((u: number) => number) = (u) => depthAlong(seg, u)): TrackGeometry {
  const S = samples(seg, extra);
  const hw = BEAM_W / 2 + extra;
  const n0 = -BALL_R + extra;
  const dAt = (i: number) => -BALL_R - (typeof depth === 'number' ? depth : depth(i / (S.length - 1))) - extra;
  S.forEach((s, i) => (s.d = dAt(i)));
  const at = (s: Sample, nv: number, wv: number) =>
    s.p.clone().addScaledVector(s.n, nv === BOTTOM ? s.d! : nv).addScaledVector(s.w, wv);
  const n1 = BOTTOM;
  const b = new Builder();
  for (let i = 0; i < S.length - 1; i++) {
    const s = S[i], e = S[i + 1];
    const nS = s.n, nE = e.n, mS = s.n.clone().negate(), mE = e.n.clone().negate();
    b.quad(at(s, n0, -hw), at(e, n0, -hw), at(e, n0, hw), at(s, n0, hw), nS, nE, nE, nS, [[-1, 0], [-1, 0], [1, 0], [1, 0]]);
    b.quad(at(s, n1, -hw), at(e, n1, -hw), at(e, n1, hw), at(s, n1, hw), mS, mE, mE, mS, [[0, 1], [0, 1], [0, 1], [0, 1]]);
    b.quad(at(s, n0, hw), at(e, n0, hw), at(e, n1, hw), at(s, n1, hw), s.w, e.w, e.w, s.w, [[0, 0], [0, 0], [0, 1], [0, 1]]);
    const wS = s.w.clone().negate(), wE = e.w.clone().negate();
    b.quad(at(s, n0, -hw), at(e, n0, -hw), at(e, n1, -hw), at(s, n1, -hw), wS, wE, wE, wS, [[0, 0], [0, 0], [0, 1], [0, 1]]);
  }
  const cap = (s: Sample, out: THREE.Vector3) => {
    const c = new Builder();
    c.quad(at(s, n0, -hw), at(s, n0, hw), at(s, n1, hw), at(s, n1, -hw), out, out, out, out, [[0, 0], [0, 0], [0, 1], [0, 1]]);
    return c.geometry();
  };
  const first = S[0], last = S[S.length - 1];
  return { body: b.geometry(), caps: [cap(first, first.t.clone().negate()), cap(last, last.t.clone())] };
}

/**
 * Glow quad covering a segment's cross-section at one end.
 * uv.y = 1 at the riding surface; uv.x runs across the width (0 at −w, 1 at +w).
 */
export function seamGeometry(seg: Segment, atEnd: 0 | 1) {
  const f = frameAt(seg, 1, atEnd ? lengthOf(seg) : 0);
  const p = vec(f.p), t = vec(f.t), n = vec(f.n);
  const w = new THREE.Vector3().crossVectors(t, n);
  const pad = 0.04;
  const hw = BEAM_W / 2 + pad;
  const n0 = -BALL_R + pad, n1 = -BALL_R - BEAM_D - pad;
  const P = (nv: number, wv: number) => p.clone().addScaledVector(n, nv).addScaledVector(w, wv);
  const c = [P(n1, -hw), P(n1, hw), P(n0, hw), P(n0, -hw)];
  const pos: number[] = [], uv: number[] = [];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(c[i].x, c[i].y, c[i].z); uv.push(uvs[i][0], uvs[i][1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { geometry: g, w, aspect: (BEAM_W + 2 * pad) / (BEAM_D + 2 * pad) };
}

/** Rounded handle nub on the side of a movable piece that faces the camera. */
export function nubGeometry(seg: Segment, view: V3) {
  const f = frameAt(seg, 1, lengthOf(seg) / 2);
  const t = vec(f.t), n = vec(f.n);
  const w = new THREE.Vector3().crossVectors(t, n);
  const side = w.dot(vec(view)) >= 0 ? 1 : -1;
  const g = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 20);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), w.clone().multiplyScalar(side)));
  const c = vec(f.p).addScaledVector(n, -BALL_R - BEAM_D / 2).addScaledVector(w, side * (BEAM_W / 2 + 0.03));
  g.translate(c.x, c.y, c.z);
  return g;
}

/**
 * Small hub marking the centre a rotatable piece turns about. That centre is the middle of the piece's curve,
 * where the ball passes at radius 1, so the hub sits exactly on it and stays small: from every view it is at
 * least 0.58 away from the ball's path on screen, so it can never cover the ball (a cap sticking out toward
 * the camera did, in one view or another).
 */
export function pivotGeometry(pivot: V3) {
  const g = new THREE.SphereGeometry(0.15, 20, 14);
  g.translate(pivot[0], pivot[1], pivot[2]);
  return g;
}

/** Start hook: a post beside the start with an arm across the track that swings up on release. */
export function hookParts(seg: Segment, view: V3) {
  const f = frameAt(seg, 1, 0);
  const t = vec(f.t), n = vec(f.n), w = new THREE.Vector3().crossVectors(t, n);
  const side: 1 | -1 = w.dot(vec(view)) >= 0 ? 1 : -1;
  const base = vec(f.p).addScaledVector(t, 0.42).addScaledVector(n, -BALL_R).addScaledVector(w, side * (BEAM_W / 2 - 0.08));
  const postH = BALL_R * 2 + 0.12;
  const post = new THREE.BoxGeometry(0.12, postH, 0.12);
  post.translate(0, postH / 2, 0);
  const armLen = BEAM_W - 0.12;
  const arm = new THREE.BoxGeometry(0.09, 0.09, armLen);
  arm.translate(0, 0, -side * armLen / 2);
  const basis = new THREE.Matrix4().makeBasis(t, n, w);
  post.applyMatrix4(basis);
  arm.applyMatrix4(basis);
  const pivot = base.clone().addScaledVector(n, postH - 0.06);
  return { post, postAt: base, arm, pivot, hingeAxis: t.clone(), side };
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
  const surface = vec(at).addScaledVector(n, -BALL_R);
  for (const g of [bowl, rim]) { g.applyQuaternion(q); g.translate(surface.x, surface.y, surface.z); }
  return { bowl, rim, surface };
}

/** Rest pad: a low cradle ring on the riding surface. */
export function padGeometry(at: V3, n: THREE.Vector3) {
  const ring = new THREE.TorusGeometry(0.3, 0.045, 10, 40);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.03, 0);
  ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
  const s = vec(at).addScaledVector(n, -BALL_R);
  ring.translate(s.x, s.y, s.z);
  return ring;
}

