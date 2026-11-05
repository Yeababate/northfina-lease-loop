import { expect, it } from 'vitest';
import { contractEndOn } from './contract-period';
it.each([
  ['2026-01-31', 1, '2026-02-28'],
  ['2028-01-31', 1, '2028-02-29'],
  ['2000-01-31', 1, '2000-02-29'],
  ['2100-01-31', 1, '2100-02-28'],
  ['2026-03-31', 1, '2026-04-30'],
  ['2026-11-05', 36, '2029-11-05'],
])('period %s plus %s months', (start, months, end) => {
  expect(contractEndOn(start, months)).toBe(end);
});
it('rejects invalid dates and terms', () => {
  expect(() => contractEndOn('bad', 12)).toThrow();
  expect(() => contractEndOn('2026-11-05', 0)).toThrow();
  expect(() => contractEndOn('2026-11-05', 1.5)).toThrow();
});
