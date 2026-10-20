import { expect, it } from 'vitest';
import { newer } from '../src/core/version';

it('compares release versions numerically', () => {
  expect(newer('v0.3.1', '0.3.0')).toBe(true);
  expect(newer('0.10.0', '0.9.9')).toBe(true);
  expect(newer('v1.0', '0.99.99')).toBe(true);
  expect(newer('0.3.0', '0.3.0')).toBe(false);
  expect(newer('v0.2.1', '0.3.0')).toBe(false);
});
