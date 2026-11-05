import { beforeAll, describe, expect, it } from 'vitest';
import { loadVatRates } from '@/data/load';
import type { VatRate } from '@/data/schemas';
import { nextVatChangeAfter, vatCents, vatRateOn } from './vat';

let rates: VatRate[];
beforeAll(async () => {
  rates = (await loadVatRates()).rates;
});

describe('vatRateOn', () => {
  it('uses 25.5 % up to and including 31 Dec 2026', () => {
    expect(vatRateOn(rates, '2026-11-05')).toMatchObject({
      ok: true,
      rate: { rate_percent: 25.5 },
    });
    expect(vatRateOn(rates, '2026-12-31')).toMatchObject({
      ok: true,
      rate: { rate_percent: 25.5 },
    });
  });

  it('switches to the fictional 26 % on 1 Jan 2027 and keeps it', () => {
    expect(vatRateOn(rates, '2027-01-01')).toMatchObject({
      ok: true,
      rate: { rate_percent: 26, fictional: true },
    });
    expect(vatRateOn(rates, '2035-06-30')).toMatchObject({ ok: true, rate: { rate_percent: 26 } });
  });

  it('uses 24 % on the last day before September 2024', () => {
    expect(vatRateOn(rates, '2024-08-31')).toMatchObject({ ok: true, rate: { rate_percent: 24 } });
    expect(vatRateOn(rates, '2024-09-01')).toMatchObject({
      ok: true,
      rate: { rate_percent: 25.5 },
    });
  });

  it('has no rate before the first one starts, or with no rates', () => {
    expect(vatRateOn(rates, '2012-12-31')).toEqual({ ok: false, reason: 'no_rate_on_date' });
    expect(vatRateOn([], '2026-11-05')).toEqual({ ok: false, reason: 'no_rate_on_date' });
  });

  it('throws on a date that is not YYYY-MM-DD', () => {
    expect(() => vatRateOn(rates, '5.11.2026')).toThrow(RangeError);
  });
});

describe('nextVatChangeAfter', () => {
  it('finds the 2027 change from a 2026 date', () => {
    expect(nextVatChangeAfter(rates, '2026-11-05')).toMatchObject({
      rate_percent: 26,
      valid_from: '2027-01-01',
    });
  });

  it('finds nothing once the last rate applies, including on its first day', () => {
    expect(nextVatChangeAfter(rates, '2027-01-01')).toBeNull();
    expect(nextVatChangeAfter(rates, '2030-01-01')).toBeNull();
  });

  it('skips a later period that keeps the same rate', () => {
    const same: VatRate[] = [
      { rate_percent: 24, valid_from: '2020-01-01', valid_to: '2020-12-31' },
      { rate_percent: 24, valid_from: '2021-01-01', valid_to: '2021-12-31' },
      { rate_percent: 25, valid_from: '2022-01-01', valid_to: null },
    ];
    expect(nextVatChangeAfter(same, '2020-06-01')).toMatchObject({ rate_percent: 25 });
  });

  it('returns the first rate when the date is before every rate', () => {
    expect(nextVatChangeAfter(rates, '2012-01-01')).toMatchObject({ rate_percent: 24 });
  });
});

describe('vatCents', () => {
  it('matches the worked example in data/DATA.md', () => {
    expect(vatCents(10_730, 25.5)).toBe(2736); // 2736.15 → 2736
  });

  it('rounds half a cent up', () => {
    expect(vatCents(100, 25.5)).toBe(26); // 25.5 → 26
    expect(vatCents(1, 26)).toBe(0); // 0.26 → 0
    expect(vatCents(2, 25)).toBe(1); // 0.5 → 1
  });

  it('charges more at 26 % on the same net rent', () => {
    expect(vatCents(10_730, 26)).toBe(2790); // 2789.8 → 2790
  });

  it('is zero on zero', () => {
    expect(vatCents(0, 25.5)).toBe(0);
  });
});
