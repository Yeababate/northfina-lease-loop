import { describe, expect, it } from 'vitest';
import { defaultReminderPreferences, type ReminderPreferences } from './reminder-preferences';
import {
  eventVersion,
  lastCoveredDay,
  leaseEndDeadline,
  occurrenceKey,
  planSchedule,
} from './reminder-schedule';

const event = { contractId: 'c1', recipientId: 'cust-aino', endOn: '2026-12-05' };
const signedAt = '2026-11-01T10:00:00.000Z';
const one = (zone: string, daysBefore: number, time = '09:00'): ReminderPreferences => ({
  enabled: true,
  timeZone: zone,
  rules: [{ id: 'x', daysBefore, time, channels: ['in_app'], enabled: true }],
});

describe('deadline', () => {
  it('is the start of the exclusive end date in Helsinki', () => {
    expect(leaseEndDeadline('2026-12-05')).toBe('2026-12-04T22:00:00.000Z');
    expect(leaseEndDeadline('2027-07-01')).toBe('2027-06-30T21:00:00.000Z');
    expect(lastCoveredDay('2027-01-01')).toBe('2026-12-31');
    expect(eventVersion('2026-12-05')).toBe('end:2026-12-05');
  });
});

describe('planSchedule', () => {
  it('schedules the default 30/7/1 reminders at 09:00 Helsinki time', () => {
    const schedule = planSchedule(event, defaultReminderPreferences('Europe/Helsinki'), signedAt);
    expect(schedule.problems).toEqual([]);
    expect(schedule.occurrences.map((o) => [o.daysBefore, o.localDate, o.dueAt, o.state])).toEqual([
      [30, '2026-11-05', '2026-11-05T07:00:00.000Z', 'scheduled'],
      [7, '2026-11-28', '2026-11-28T07:00:00.000Z', 'scheduled'],
      [1, '2026-12-04', '2026-12-04T07:00:00.000Z', 'scheduled'],
    ]);
  });
  it('counts days back from the deadline as seen in the renter zone', () => {
    // 00:00 Helsinki is 22:00 the day before in London, so the local deadline day is 4 Dec.
    const london = planSchedule(event, one('Europe/London', 1), signedAt);
    expect(london.occurrences[0]).toMatchObject({
      localDate: '2026-12-03',
      dueAt: '2026-12-03T09:00:00.000Z',
    });
    expect(planSchedule(event, one('Europe/London', 0, '21:59'), signedAt).problems).toEqual([]);
  });
  it('rejects a reminder at or after the deadline', () => {
    expect(planSchedule(event, one('Europe/Helsinki', 0), signedAt).problems).toEqual([
      { ruleId: 'x', reason: 'after_end' },
    ]);
    expect(planSchedule(event, one('Europe/London', 0, '22:00'), signedAt).problems).toEqual([
      { ruleId: 'x', reason: 'after_end' },
    ]);
  });
  it('marks reminders that were already due when the settings were saved', () => {
    const late = planSchedule(
      event,
      defaultReminderPreferences('Europe/Helsinki'),
      '2026-11-10T00:00:00Z'
    );
    expect(late.occurrences.map((o) => o.state)).toEqual([
      'already_past',
      'scheduled',
      'scheduled',
    ]);
    const exact = planSchedule(event, one('Europe/Helsinki', 30), '2026-11-05T07:00:00.000Z');
    expect(exact.occurrences[0]!.state).toBe('already_past');
  });
  it('handles the spring gap and month/year boundaries', () => {
    const spring = planSchedule(
      { ...event, endOn: '2027-04-04' },
      one('Europe/Helsinki', 7, '03:30'),
      signedAt
    );
    expect(spring.occurrences[0]).toMatchObject({
      localDate: '2027-03-28',
      dueAt: '2027-03-28T01:30:00.000Z',
      adjustment: 'gap',
    });
    const newYear = planSchedule(
      { ...event, endOn: '2027-01-01' },
      one('UTC', 1, '23:30'),
      signedAt
    );
    expect(newYear.occurrences[0]).toMatchObject({
      localDate: '2026-12-30',
      dueAt: '2026-12-30T23:30:00.000Z',
    });
  });
  it('produces nothing when reminders are switched off', () => {
    const off = { ...defaultReminderPreferences('Europe/Helsinki'), enabled: false };
    expect(planSchedule(event, off, signedAt).occurrences).toEqual([]);
  });
});

describe('occurrenceKey', () => {
  it('ignores the clock time but changes with the offset and the end date', () => {
    const base = occurrenceKey(event, { id: 'd7', daysBefore: 7 });
    expect(base).toBe('c1|cust-aino|end%3A2026-12-05|d7|7');
    expect(occurrenceKey(event, { id: 'd7', daysBefore: 6 })).not.toBe(base);
    expect(occurrenceKey({ ...event, endOn: '2026-12-06' }, { id: 'd7', daysBefore: 7 })).not.toBe(
      base
    );
  });
});
