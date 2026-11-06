import { describe, expect, it } from 'vitest';
import { demoToday, todayIso } from './today';

describe('todayIso', () => {
  it('returns the date in Helsinki, not in UTC', () => {
    // 22:30 UTC on 5 November is already 6 November in Helsinki (UTC+2 in winter).
    expect(todayIso(new Date('2026-11-05T22:30:00Z'))).toBe('2026-11-06');
    expect(todayIso(new Date('2026-11-05T21:30:00Z'))).toBe('2026-11-05');
  });

  it('can use another time zone', () => {
    expect(todayIso(new Date('2026-11-05T22:30:00Z'), 'UTC')).toBe('2026-11-05');
  });

  it('uses the real clock by default', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('demo date', () => {
  const original = process.env.LEASE_LOOP_TODAY;
  const restore = () => {
    if (original === undefined) delete process.env.LEASE_LOOP_TODAY;
    else process.env.LEASE_LOOP_TODAY = original;
  };

  it('uses LEASE_LOOP_TODAY when set, so dated scenario cards can be replayed', () => {
    process.env.LEASE_LOOP_TODAY = '2026-11-05';
    try {
      expect(todayIso()).toBe('2026-11-05');
      expect(demoToday()).toBe('2026-11-05');
      // An explicit date still wins.
      expect(todayIso(new Date('2027-01-01T12:00:00Z'))).toBe('2027-01-01');
    } finally {
      restore();
    }
  });

  it('ignores a value that is not a real date', () => {
    process.env.LEASE_LOOP_TODAY = '2026-02-30';
    try {
      expect(demoToday()).toBeNull();
      expect(todayIso()).not.toBe('2026-02-30');
    } finally {
      restore();
    }
  });
});
