import { expect, it } from 'vitest';
import { loadRefurbishmentCosts } from '@/data/load';
import { buildPassport, passportWorkCost } from './passport';

it('retains seed-only lives without inventing dates, prices, or carbon savings', () => {
  const empty = { category: 'e_bike' as const, lives: [], importedWork: [], impact: null };
  expect(buildPassport({ ...empty, previousLives: 0 })).toMatchObject({
    earlierLives: 0,
    lives: [],
    totals: { lives: 0 },
  });
  expect(buildPassport({ ...empty, previousLives: 2 })).toMatchObject({
    earlierLives: 2,
    lives: [],
    totals: { lives: 2, estimatedCo2SavingGrams: null },
  });
});

it('uses the recorded service hours to price each started interval', async () => {
  const { farm_machine: costs } = await loadRefurbishmentCosts();
  expect(passportWorkCost('major_service', costs, 1001)).toBe(300_000);
  expect(passportWorkCost('major_service', costs, null)).toBeNull();
  expect(passportWorkCost('unknown', costs, 1001)).toBeNull();
});
