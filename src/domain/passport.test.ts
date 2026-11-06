import { expect, it } from 'vitest';
import { loadRefurbishmentCosts } from '@/data/load';
import { buildPassport, isLeaseLife, passportWorkCost, type PassportLifeFact } from './passport';
import { AWAITING_SIGNATURE } from './signatory';

it('counts a contract as a life only once it is signed', () => {
  expect(isLeaseLife(AWAITING_SIGNATURE)).toBe(false);
  expect(isLeaseLife('active')).toBe(true);
  expect(isLeaseLife('passed_on')).toBe(true);
  expect(isLeaseLife(undefined)).toBe(true);
  expect(isLeaseLife(null)).toBe(true);
});

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

it('prices known upgrades and fixed work, leaving unknown rules unpriced', async () => {
  const { laptop: costs } = await loadRefurbishmentCosts();
  const [upgrade, price] = Object.entries(costs.condition_upgrades)[0]!;
  expect(passportWorkCost(`upgrade:${upgrade}`, costs, null)).toBe(price);
  expect(passportWorkCost('upgrade:unknown', costs, null)).toBeNull();
  const fixed = costs.fixed[0]!;
  expect(passportWorkCost(fixed.id, costs, null)).toBe(fixed.cost_cents);
  expect(
    passportWorkCost(fixed.id, { ...costs, fixed: [{ ...fixed, when: 'unknown_rule' }] }, null)
  ).toBeNull();
});

it('keeps unpriced work and unestimated lives explicit when impact inputs are absent', () => {
  const life: PassportLifeFact = {
    startOn: '2026-01-01',
    endOn: null,
    scheduledEndOn: '2027-01-01',
    ending: 'active',
    termMonths: 12,
    monthlyNetCents: 1000,
    priceSource: 'price_list',
    priceListVersion: 1,
    start: { condition: 'good', usage: { unit: 'km', value: 0 } },
    returned: null,
    priorUsage: 0,
    countedCompletion: false,
    refurbishment: [],
  };
  expect(
    buildPassport({
      category: 'e_bike',
      previousLives: 0,
      lives: [life],
      importedWork: [{ actionId: 'unknown', on: '2026-01-01', costCents: null }],
      impact: null,
    })
  ).toMatchObject({
    lives: [{ number: 1, estimatedCo2SavingGrams: null }],
    totals: {
      estimatedLives: 0,
      estimatedCo2SavingGrams: null,
      refurbishmentCents: 0,
      unpricedWork: 1,
    },
  });
});
