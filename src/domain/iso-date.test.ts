import { describe, expect, it } from 'vitest';
import { ageOn, isIsoDate } from './iso-date';

describe('isIsoDate', () => {
  it('accepts real days, including 29 February in leap years', () => {
    for (const day of ['2026-11-05', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01']) {
      expect(isIsoDate(day)).toBe(true);
    }
  });

  it('rejects days that do not exist and other shapes', () => {
    for (const day of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10']) {
      expect(isIsoDate(day)).toBe(false);
    }
    for (const text of ['', '5.11.2026', '2026-1-5', '2026-11-05T00:00', '20261105']) {
      expect(isIsoDate(text)).toBe(false);
    }
  });
});

describe('ageOn', () => {
  it('counts a birthday on the day itself', () => {
    expect(ageOn('2008-11-05', '2026-11-05')).toBe(18);
    expect(ageOn('2008-11-06', '2026-11-05')).toBe(17);
  });

  it('gives Mikko (born 10 March 2009) 17 years on 5 November 2026', () => {
    expect(ageOn('2009-03-10', '2026-11-05')).toBe(17);
  });

  it('makes a 29 February birthday count on 1 March in non-leap years', () => {
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
  });

  it('gives 0 on the day of birth and throws on dates that do not exist', () => {
    expect(ageOn('2026-11-05', '2026-11-05')).toBe(0);
    expect(() => ageOn('2026-02-30', '2026-11-05')).toThrow(RangeError);
  });
});
