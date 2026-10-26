import { describe, expect, it } from 'vitest';
import { LEVELS } from '../levels';
import { type BallState, PHYS, stepBall } from '../src/core/ball';
import { BALL_R, hiddenByTris, toScreen, triDist2 } from '../src/core/contact';
import { initialStates, startSegment } from '../src/core/level';
import { worldFor } from '../src/core/solver';
import { frameAt, lengthOf, pointAt } from '../src/core/track';
import { HOOK_LEAD, HOOK_LIFT, HOOK_STUB } from '../src/render/geometry';
import { hookSoups } from './audit';

/** Clear space kept between the ball's disc and the start gate on screen. */
const GAP = 0.04;
/** How much of the bar shows `t` seconds after release (the game's ease out cubic). */
const bar = (t: number) => 1 - (1 - HOOK_STUB) * (1 - (1 - Math.min(1, t / HOOK_LIFT)) ** 3);

/** Nearest the gate comes to the ball's centre on screen, at any depth (in front of the ball or behind it). */
function screenGap(level: (typeof LEVELS)[number], view: number, ball: readonly number[], shown: number) {
  const [bx, by] = toScreen(ball, view);
  let best = Infinity;
  for (const soup of hookSoups(level, shown)) {
    const flat = new Float64Array(soup.length);
    for (let i = 0; i < soup.length; i += 3) {
      const [x, y] = toScreen([soup[i], soup[i + 1], soup[i + 2]], view);
      flat.set([x, y, 0], i);
    }
    for (let o = 0; o < flat.length; o += 9) best = Math.min(best, Math.sqrt(triDist2([bx, by, 0], flat, o)));
  }
  return best;
}

// The release gate must read as a gate, not a skewer: the waiting ball and the gate never overlap on screen,
// in any view the level allows, with the gate closed or opening. Once the ball rolls it never touches the gate.
describe.each(LEVELS.map((l) => [l.id, l] as const))('%s start gate', (_id, level) => {
  const seg = startSegment(level);
  const ball = frameAt(seg, 1, 0).p;

  it('stays clear of the waiting ball on screen, closed and opening', () => {
    for (const view of level.views) {
      for (let i = 0; i <= 16; i++) {
        const shown = 1 - ((1 - HOOK_STUB) * i) / 16;
        expect(screenGap(level, view, ball, shown), `view ${view}, bar ${shown.toFixed(2)} shown`).toBeGreaterThan(BALL_R + GAP);
      }
    }
  });

  it('is out of the way before the ball reaches it', () => {
    const world = worldFor(level, initialStates(level), level.startView);
    const b: BallState = { segId: seg.id, dir: 1, dist: 0, mode: 'rolling', bumps: 0, bumped: false, turns: 0, speed: PHYS.cruise };
    const dt = 1 / 60;
    for (let t = HOOK_LEAD; t < HOOK_LIFT + 0.5 && b.mode === 'rolling'; t += dt) {
      stepBall(b, world, dt);
      const on = world.segments.find((s) => s.id === b.segId)!;
      const p = pointAt(on, b.dir, Math.min(b.dist, lengthOf(on)));
      const soups = hookSoups(level, bar(t + dt));
      let near = Infinity;
      for (const soup of soups) for (let o = 0; o < soup.length; o += 9) near = Math.min(near, Math.sqrt(triDist2(p as [number, number, number], soup, o)));
      expect(near, `t=${t.toFixed(2)} on ${b.segId}`).toBeGreaterThan(BALL_R);
      expect(hiddenByTris(p, soups, level.startView), `t=${t.toFixed(2)} hidden on ${b.segId}`).toBe(false);
    }
  });
});
