// Animation primitives: frame-rate independent, allocation-free per frame.
// Sources: howlingmoonsoftware.com/improved-lerp-smoothing, theorangeduck.com/page/spring-roll-call

/** Exponential smoothing toward b. lambda ≈ 8–15 snappy, 3–6 floaty. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-lambda * dt));

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};

interface Tween {
  t: number; dur: number; delay: number; from: number; to: number;
  set: (v: number) => void; e: (t: number) => number; done?: () => void; active: boolean; tag?: string;
}
const tweens: Tween[] = [];

export function tween(
  from: number, to: number, dur: number, set: (v: number) => void,
  opts: { ease?: (t: number) => number; delay?: number; done?: () => void; tag?: string } = {},
) {
  if (opts.tag) cancelTweens(opts.tag);
  let tw = tweens.find((x) => !x.active);
  if (!tw) { tw = {} as Tween; tweens.push(tw); }
  Object.assign(tw, {
    t: 0, dur: Math.max(dur, 1e-4), delay: opts.delay ?? 0, from, to, set,
    e: opts.ease ?? ease.outCubic, done: opts.done, active: true, tag: opts.tag,
  });
  return tw;
}

/** Stop everything (e.g. when a level is torn down) so no stale callback touches the next one. */
export function cancelAllTweens() {
  for (const tw of tweens) tw.active = false;
}

export function cancelTweens(tag: string) {
  for (const tw of tweens) if (tw.active && tw.tag === tag) tw.active = false;
}

export function updateTweens(dt: number) {
  for (let i = 0; i < tweens.length; i++) {
    const tw = tweens[i];
    if (!tw.active) continue;
    if (tw.delay > 0) { tw.delay -= dt; continue; }
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    tw.set(tw.from + (tw.to - tw.from) * tw.e(tw.t));
    if (tw.t === 1) { tw.active = false; tw.done?.(); }
  }
}

export const activeTweens = () => tweens.reduce((n, tw) => n + (tw.active ? 1 : 0), 0);

/** Damped spring. f = Hz, zeta = 1 is critically damped (no overshoot — Seamline's default). */
export interface Spring { x: number; v: number; target: number }

export function stepSpring(s: Spring, f: number, zeta: number, dt: number): boolean {
  const w = 2 * Math.PI * f;
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -2 * zeta * w * s.v - w * w * (s.x - s.target);
    s.v += a * h;
    s.x += s.v * h;
  }
  const atRest = Math.abs(s.v) < 1e-3 && Math.abs(s.x - s.target) < 1e-3;
  if (atRest) { s.x = s.target; s.v = 0; }
  return atRest;
}

// Reduced motion: OS preference with an in-app override (null = follow OS).
const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let osReduced = mq?.matches ?? false;
let override: boolean | null = null;
mq?.addEventListener('change', (e) => { osReduced = e.matches; });
export const reducedMotion = () => override ?? osReduced;
export const setReducedMotion = (v: boolean | null) => { override = v; };
