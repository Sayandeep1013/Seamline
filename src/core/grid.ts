// Integer grid maths (GAME_PLAN §4.1). Pure, no rendering.

export type V3 = readonly [number, number, number];
export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export const AXES: Record<Axis, V3> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/** View vectors v0..v3: camera looks along −v, rotated 90° about y per step. */
export const VIEWS: readonly V3[] = [[1, 1, 1], [1, 1, -1], [-1, 1, -1], [-1, 1, 1]];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const eq = (a: V3, b: V3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const manhattan = (a: V3): number => Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]);

export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function axisOf(v: V3): Axis | null {
  for (const k in AXES) {
    if (eq(AXES[k as Axis], v)) return k as Axis;
  }
  return null;
}

export const negate = (a: Axis): Axis => (a[0] === '+' ? '-' : '+') + a[1] as Axis;

/** Direction of a straight from→to as a unit axis, or null if not axis-aligned. */
export function directionOf(from: V3, to: V3): Axis | null {
  const d = sub(to, from);
  const len = manhattan(d);
  if (len === 0) return null;
  return axisOf(scale(d, 1 / len));
}

/**
 * The join rule's position test (§4.3): returns integer k with d = k·v, or null.
 * k = 0 is a physical join, k ≠ 0 a perceptual one.
 */
export function viewMultiple(d: V3, v: V3): number | null {
  const k = d[1] / v[1];
  if (!Number.isInteger(k)) return null;
  if (d[0] !== k * v[0] || d[2] !== k * v[2]) return null;
  return k === 0 ? 0 : k; // normalise −0
}

/** Screen projection for view 0 (debug/rendering only; rules never use it). */
export function projectV0(p: V3): [number, number] {
  return [(p[0] - p[2]) / Math.SQRT2, (2 * p[1] - p[0] - p[2]) / Math.sqrt(6)];
}
