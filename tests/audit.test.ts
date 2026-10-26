import { describe, expect, it } from 'vitest';
import { LEVELS } from '../levels';
import { auditLevel, describeViolation } from './audit';

// What looks solid is solid (GAME_PLAN §4.4b), checked the way a player sees it: every release from every
// reachable state, every frame, against the exact drawn triangles. No overlaps, nothing hidden.
describe.each(LEVELS.map((l) => [l.id, l] as const))('%s', (_id, level) => {
  it('never shows the ball inside or behind a solid', () => {
    const { violations, runs } = auditLevel(level);
    if (violations.length) console.log(`${level.id} ${level.name}: ${violations.length} problem(s) in ${runs} runs\n  ` + violations.map(describeViolation).join('\n  '));
    expect(violations).toEqual([]);
  }, 120000);
});
