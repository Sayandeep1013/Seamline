import { describe, expect, it } from 'vitest';
import { LEVELS } from '../levels';
import { simulate } from '../src/core/ball';
import { initialStates, startSegment, validateLevel } from '../src/core/level';
import { describe as say, solve, worldFor } from '../src/core/solver';
import { Solidity } from '../src/core/solidity';

// Every level must pass the solver with its documented par (GAME_PLAN §10.4).
describe.each(LEVELS.map((l) => [l.id, l] as const))('%s', (_id, level) => {
  it('is well-formed', () => expect(() => validateLevel(level)).not.toThrow());

  it(`is solvable in par ${level.par}`, () => {
    const r = solve(level);
    if (process.env.SOLVE_VERBOSE) console.log(level.id, level.name, `par ${r.par}:`, r.solution.map(say).join(' · '));
    expect(r.solvable).toBe(true);
    expect(r.par).toBe(level.par);
  });

  it('starts with every piece clear of the track and of each other', () => {
    expect(new Solidity(level).legal(initialStates(level))).toBe(true);
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
    for (const z of [-1, 0, 1]) {
      const { outcome, events } = run(z);
      expect(outcome).toBe(z === 1 ? 'goal' : 'rest');
      if (z === 1) expect(events.filter((e) => e.type === 'cross').map((e) => e.type === 'cross' && e.k)).toEqual([-1]);
    }
  });

  it('rolls off an unjoined end, falls into the void and returns to the start', () => {
    const r = run(-1);
    expect(r.events.map((e) => e.type)).toEqual(['fall']);
    expect(r.events[0]).toMatchObject({ result: 'lost' });
    expect(r.ball).toMatchObject({ segId: 'A', dir: 1, dist: 0, mode: 'resting' });
  });
});

describe('falling and solidity', () => {
  const level = LEVELS[2]; // The Star: a capped pillar
  it('a capped end still bumps the ball back', () => {
    // With the star in the player's hand nothing can catch the ball at the foot of the pillar.
    const w = { ...worldFor(level, { ST: { s: 1, r: 0 } }, 0), moving: new Set(['ST']) };
    const r = simulate(w, { segId: 'P', dir: 1, dist: 4.5, mode: 'resting' });
    expect(r.events.some((e) => e.type === 'bump')).toBe(true);
  });

  it('The Star has exactly one winning position, and no position loops', () => {
    for (const s of [1, 2, 3, 4]) {
      const r = simulate(worldFor(level, { ST: { s, r: 0 } }, 0), { segId: 'A', dir: 1, dist: 0, mode: 'resting' });
      expect(r.outcome).toBe(s === 4 ? 'goal' : 'rest');
    }
  });

  it('a piece drawn in front of the ball blocks it (Turn, elbow covering the pillar)', () => {
    const r = simulate(worldFor(LEVELS[1], { EL: { s: 0, r: 3 } }, 0), { segId: 'A', dir: 1, dist: 0, mode: 'resting' });
    expect(r.events.some((e) => e.type === 'bump')).toBe(true);
    expect(r.events.some((e) => e.type === 'fall')).toBe(false);
  });

  it('lands on a floor below and keeps rolling the same way', () => {
    const lvl = {
      ...LEVELS[0], id: 'T', restPads: [],
      fixed: [
        { id: 'A', type: 'straight', from: [0, 2, 0], to: [2, 2, 0], n: '+y', ends: ['start', 'open'] },
        { id: 'F', type: 'straight', from: [2, 0, 0], to: [6, 0, 0], n: '+y', ends: ['open', 'goal'] },
      ],
      pieces: [],
    } as unknown as typeof level;
    const r = simulate(worldFor(lvl, {}, 0), { segId: 'A', dir: 1, dist: 0, mode: 'resting' });
    expect(r.events[0]).toMatchObject({ type: 'fall', result: 'roll', to: [3, 0, 0] });
    expect(r.outcome).toBe('goal');
  });

  it('a piece cannot be slid or turned through the track', () => {
    const solid = new Solidity(LEVELS[4]); // Hold: S slides along z past the start beam
    expect(solid.free('S', { s: 1, q: 0 }, initialStates(LEVELS[4]))).toBe(true);
    // Drop a ball right where the beam would go: now the move is blocked.
    expect(solid.canMove('S', { s: 0, r: 0 }, { s: 1, r: 0 }, initialStates(LEVELS[4]), [4, 1, 1])).toBe(false);
  });
});
