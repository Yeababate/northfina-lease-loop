import { describe, expect, it } from 'vitest';
import { buildPassport } from './item-passport';

describe('buildPassport', () => {
  it('starts with the model year and the lives before our records', () => {
    const passport = buildPassport({ modelYear: 2022, previousLives: 2, leases: [], events: [] });
    expect(passport.lifeNumber).toBe(3);
    expect(passport.entries).toEqual([
      { kind: 'made', year: 2022 },
      { kind: 'earlier_lives', count: 2 },
    ]);
  });

  it('lists the return, checks, work, relisting and new lease in order', () => {
    const passport = buildPassport({
      modelYear: 2023,
      previousLives: 2,
      leases: [{ startOn: '2026-11-06', termMonths: 24 }],
      events: [
        { type: 'received', on: '2026-10-01', details: { early: false } },
        { type: 'life_completed', on: '2026-10-01', details: null },
        { type: 'inspected', on: '2026-11-06', details: { condition: 'fair' } },
        { type: 'work_recorded', on: '2026-11-06', details: { actionId: 'battery_replacement' } },
        { type: 'relisted', on: '2026-11-06', details: { priceCents: 151_661 } },
        { type: 'something_else', on: '2026-11-06', details: null },
      ],
    });
    // One life is recorded (life_completed), so one earlier life is before our records.
    expect(passport.entries).toEqual([
      { kind: 'made', year: 2023 },
      { kind: 'earlier_lives', count: 1 },
      { kind: 'returned', on: '2026-10-01' },
      { kind: 'inspected', on: '2026-11-06', condition: 'fair' },
      { kind: 'work', on: '2026-11-06', actionId: 'battery_replacement' },
      { kind: 'relisted', on: '2026-11-06', priceCents: 151_661 },
      { kind: 'leased', on: '2026-11-06', termMonths: 24 },
    ]);
  });

  it('ignores malformed details instead of guessing', () => {
    const passport = buildPassport({
      modelYear: 2024,
      previousLives: 0,
      leases: [],
      events: [
        { type: 'work_recorded', on: '2026-11-06', details: { actionId: 5 } },
        { type: 'relisted', on: '2026-11-06', details: { priceCents: 'cheap' } },
      ],
    });
    expect(passport.entries).toEqual([
      { kind: 'made', year: 2024 },
      { kind: 'relisted', on: '2026-11-06', priceCents: null },
    ]);
  });
});
