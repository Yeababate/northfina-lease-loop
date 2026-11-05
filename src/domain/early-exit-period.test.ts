import { describe, expect, it } from 'vitest';
import { earlyExitPeriod } from './early-exit-period';

const contract = { startOn: '2026-01-31', endOn: '2029-01-31', termMonths: 36 };

describe('early-exit period', () => {
  it('uses exclusive month ends and preserves the original day after February', () => {
    expect(earlyExitPeriod(contract, '2026-02-27')).toMatchObject({
      ok: true,
      period: {
        periodStartOn: '2026-01-31',
        effectiveEndOn: '2026-02-28',
        elapsedMonths: 1,
        remainingMonths: 35,
      },
    });
    expect(earlyExitPeriod(contract, '2026-02-28')).toMatchObject({
      ok: true,
      period: {
        periodStartOn: '2026-02-28',
        effectiveEndOn: '2026-03-31',
        elapsedMonths: 2,
        remainingMonths: 34,
      },
    });
  });
  it('handles leap February without shifting the original anniversary', () => {
    expect(earlyExitPeriod(contract, '2028-02-28')).toMatchObject({
      ok: true,
      period: { effectiveEndOn: '2028-02-29' },
    });
    expect(earlyExitPeriod(contract, '2028-02-29')).toMatchObject({
      ok: true,
      period: { effectiveEndOn: '2028-03-31' },
    });
  });
  it('does not accrue before the chosen start or add a period at maturity', () => {
    expect(earlyExitPeriod(contract, '2026-01-30')).toEqual({ ok: false, reason: 'not_started' });
    expect(earlyExitPeriod(contract, '2029-01-31')).toEqual({ ok: false, reason: 'already_ended' });
    expect(earlyExitPeriod(contract, '2029-01-30')).toMatchObject({
      ok: true,
      period: { remainingMonths: 0, elapsedMonths: 36 },
    });
  });
  it('validates dates, bounded terms and mismatched historical calendars', () => {
    expect(() => earlyExitPeriod(contract, '2026-02-30')).toThrow();
    expect(() => earlyExitPeriod({ ...contract, termMonths: 0 }, '2026-02-01')).toThrow();
    expect(() => earlyExitPeriod({ ...contract, endOn: '2029-02-01' }, '2026-02-01')).toThrow();
  });
});
