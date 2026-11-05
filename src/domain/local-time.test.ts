import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDaysBetween,
  isClockTime,
  isValidTimeZone,
  localDateTime,
  minutesBetween,
  resolveLocalTime,
} from './local-time';

describe('isValidTimeZone', () => {
  it('accepts named IANA zones and UTC', () => {
    for (const zone of ['Europe/Helsinki', 'Europe/Tallinn', 'America/New_York', 'UTC']) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
  });
  it('rejects unknown names, fixed offsets and empty strings', () => {
    for (const zone of ['', 'Mars/Olympus', '+02:00', 'UTC+2', 'Europe', 'x'.repeat(70)]) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });
});

describe('isClockTime', () => {
  it('accepts 00:00 to 23:59 only', () => {
    expect(['00:00', '09:00', '23:59'].every(isClockTime)).toBe(true);
    expect(['24:00', '9:00', '09:60', '', '09:00:00'].some(isClockTime)).toBe(false);
  });
});

describe('resolveLocalTime', () => {
  it('uses summer and winter offsets in Helsinki', () => {
    expect(resolveLocalTime('2026-07-01', '09:00', 'Europe/Helsinki')).toEqual({
      instant: '2026-07-01T06:00:00.000Z',
      adjustment: 'none',
    });
    expect(resolveLocalTime('2026-12-01', '09:00', 'Europe/Helsinki').instant).toBe(
      '2026-12-01T07:00:00.000Z'
    );
  });
  it('gives different instants for the same clock time in different zones', () => {
    expect(resolveLocalTime('2026-12-01', '09:00', 'Europe/London').instant).toBe(
      '2026-12-01T09:00:00.000Z'
    );
    expect(resolveLocalTime('2026-12-01', '09:00', 'America/New_York').instant).toBe(
      '2026-12-01T14:00:00.000Z'
    );
  });
  it('moves a time inside the spring gap forward by the gap', () => {
    const result = resolveLocalTime('2026-03-29', '03:30', 'Europe/Helsinki');
    expect(result).toEqual({ instant: '2026-03-29T01:30:00.000Z', adjustment: 'gap' });
    expect(localDateTime(result.instant, 'Europe/Helsinki')).toEqual({
      date: '2026-03-29',
      time: '04:30',
    });
  });
  it('picks the earlier of two repeated autumn times', () => {
    expect(resolveLocalTime('2026-10-25', '03:30', 'Europe/Helsinki')).toEqual({
      instant: '2026-10-25T00:30:00.000Z',
      adjustment: 'fold',
    });
  });
  it('handles midnight across a year boundary', () => {
    expect(resolveLocalTime('2027-01-01', '00:00', 'Europe/Helsinki').instant).toBe(
      '2026-12-31T22:00:00.000Z'
    );
  });
  it('throws on malformed input (a bug in the caller)', () => {
    expect(() => resolveLocalTime('2026-1-1', '09:00', 'UTC')).toThrow(RangeError);
    expect(() => resolveLocalTime('2026-01-01', '9:00', 'UTC')).toThrow(RangeError);
    expect(() => resolveLocalTime('2026-01-01', '09:00', 'Nowhere/Here')).toThrow(RangeError);
  });
});

describe('localDateTime', () => {
  it('shows the local calendar day, which can differ from the UTC day', () => {
    expect(localDateTime('2026-12-31T22:30:00.000Z', 'Europe/Helsinki')).toEqual({
      date: '2027-01-01',
      time: '00:30',
    });
    expect(localDateTime('2026-12-31T22:30:00.000Z', 'UTC')).toEqual({
      date: '2026-12-31',
      time: '22:30',
    });
  });
});

describe('calendar arithmetic', () => {
  it('adds calendar days across months, leap days and years', () => {
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-12-25', 30)).toBe('2027-01-24');
    expect(addCalendarDays('2026-11-05', 0)).toBe('2026-11-05');
  });
  it('counts calendar days and minutes between values', () => {
    expect(calendarDaysBetween('2026-11-02', '2026-11-05')).toBe(3);
    expect(calendarDaysBetween('2026-11-05', '2026-11-02')).toBe(-3);
    expect(calendarDaysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(minutesBetween('2026-11-05T07:00:00.000Z', '2026-11-05T08:30:59.000Z')).toBe(90);
  });
});
