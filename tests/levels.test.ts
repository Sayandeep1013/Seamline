import { describe, expect, it } from 'vitest';
import { LEVELS } from '../levels';
import { simulate } from '../src/core/ball';
import { initialStates, startSegment, validateLevel } from '../src/core/level';
import { describe as say, solve, worldFor } from '../src/core/solver';

// Every level must pass the solver with its documented par (GAME_PLAN §10.4).
describe.each(LEVELS.map((l) => [l.id, l] as const))('%s', (_id, level) => {
  it('is well-formed', () => expect(() => validateLevel(level)).not.toThrow());

  it(`is solvable in par ${level.par}`, () => {
    const r = solve(level);
    if (process.env.SOLVE_VERBOSE) console.log(level.id, level.name, `par ${r.par}:`, r.solution.map(say).join(' · '));
    expect(r.solvable).toBe(true);
    expect(r.par).toBe(level.par);
  });

  it('is not already solved at the start', () => {
    const world = worldFor(level, initialStates(level), level.startView);
    const ball = { segId: startSegment(level).id, dir: 1 as const, dist: 0, mode: 'resting' as const };
    expect(simulate(world, ball).outcome).not.toBe('goal');
  });
});

describe('L01 First Sight', () => {
  const level = LEVELS[0];
  const run = (z: number) =>
    simulate(worldFor(level, { B: { s: z, r: 0 } }, 0), { segId: 'A', dir: 1, dist: 0, mode: 'resting' });

  it('reaches the goal only at z = 1, through a perceptual join with k = −1', () => {
    for (const z of [-1, 0, 1, 2]) {
      const { outcome, events } = run(z);
      expect(outcome).toBe(z === 1 ? 'goal' : 'rest');
      if (z === 1) expect(events.filter((e) => e.type === 'cross').map((e) => e.type === 'cross' && e.k)).toEqual([-1]);
    }
  });

  it('bumps at the unjoined end and rolls back to rest at the start', () => {
    expect(run(-1).events.map((e) => e.type)).toEqual(['bump', 'rest']);
  });
});
