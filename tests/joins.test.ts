import { describe, expect, it } from 'vitest';
import { type Axis, type V3, VIEWS, add, scale, viewMultiple } from '../src/core/grid';
import { joinK } from '../src/core/joins';
import type { Endpoint } from '../src/core/track';

const AX: Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
const perpendicular = (a: Axis, b: Axis) => a[1] !== b[1];

describe('viewMultiple', () => {
  it('finds k for multiples of every view vector', () => {
    for (const v of VIEWS) {
      for (const k of [-3, -1, 0, 1, 2]) expect(viewMultiple(scale(v, k), v)).toBe(k);
    }
  });
  it('rejects non-multiples', () => {
    expect(viewMultiple([1, 1, 0], VIEWS[0])).toBeNull();
    expect(viewMultiple([1, 1, 1], VIEWS[1])).toBeNull();
    expect(viewMultiple([0, 0, 1], VIEWS[0])).toBeNull();
  });
});

describe('joinK truth table', () => {
  const B: V3 = [4, 1, 1];
  for (const view of [0, 1, 2, 3]) {
    for (const t of AX) {
      for (const n of AX) {
        if (!perpendicular(t, n)) continue;
        it(`view ${view}, t ${t}, n ${n}`, () => {
          const entry: Endpoint = { p: B, t, n, flag: 'open' };
          for (const k of [-2, -1, 0, 1, 2]) {
            const a = { p: add(B, scale(VIEWS[view], k)), t, n };
            expect(joinK(a, entry, VIEWS[view])).toBe(k);
            // wrong view never joins (except k = 0, which is physical in every view)
            const other = VIEWS[(view + 1) % 4];
            expect(joinK(a, entry, other)).toBe(k === 0 ? 0 : null);
            // any tangent or normal mismatch breaks the join
            for (const t2 of AX) if (t2 !== t) expect(joinK({ ...a, t: t2 }, entry, VIEWS[view])).toBeNull();
            for (const n2 of AX) if (n2 !== n) expect(joinK({ ...a, n: n2 }, entry, VIEWS[view])).toBeNull();
          }
          // only open ends are joinable
          for (const flag of ['cap', 'start', 'goal', 'drop'] as const) {
            expect(joinK({ p: B, t, n }, { ...entry, flag }, VIEWS[view])).toBeNull();
          }
        });
      }
    }
  }
});
