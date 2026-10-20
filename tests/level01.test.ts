import { describe, expect, it } from 'vitest';
import L01 from '../levels/L01.json';
import { type BallState, advance, simulate } from '../src/core/ball';
import type { JoinWorld } from '../src/core/joins';
import { type LevelDef, resolveSegments, startSegment, validateLevel } from '../src/core/level';

const level = L01 as unknown as LevelDef;
const world = (z: number): JoinWorld => ({ segments: resolveSegments(level, { B: z }), view: 0, moving: new Set() });
const start = (): BallState => ({ segId: startSegment(level).id, dir: 1, dist: 0, mode: 'resting' });

describe('L01 First Sight', () => {
  it('is a valid level', () => expect(() => validateLevel(level)).not.toThrow());

  it('reaches the goal only at z = 1, through a perceptual join with k = −1', () => {
    for (const z of level.pieces[0].move.stops) {
      const { outcome, events } = simulate(world(z), start());
      expect(outcome).toBe(z === 1 ? 'goal' : 'stuck');
      if (z === 1) expect(events.filter((e) => e.type === 'cross').map((e) => e.type === 'cross' && e.k)).toEqual([-1]);
    }
  });

  it('bumps at the unjoined end and rolls back to rest at the start', () => {
    const { events } = simulate(world(-1), start());
    expect(events.map((e) => e.type)).toEqual(['bump', 'rest']);
  });

  it('crosses back over the same join when rolling in reverse', () => {
    const w = world(1);
    const ball: BallState = { segId: 'B', dir: -1, dist: 0, mode: 'rolling' };
    const events = advance(ball, w, 3.5);
    expect(events[0]).toMatchObject({ type: 'cross', k: 1, segId: 'A' });
    expect(ball.dir).toBe(-1);
  });

  it('ignores a piece that is in the player\'s hand', () => {
    const w = { ...world(1), moving: new Set(['B']) };
    expect(simulate(w, start()).outcome).toBe('stuck');
  });
});
