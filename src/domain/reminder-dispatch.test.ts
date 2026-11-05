import { describe, expect, it } from 'vitest';
import {
  checkEligibility,
  groupDue,
  isDue,
  MAX_RETRY_DELAY_SECONDS,
  planNotification,
  retryDelaySeconds,
  type DueCandidate,
} from './reminder-dispatch';
import { defaultReminderPreferences } from './reminder-preferences';

const deadline = '2026-12-04T22:00:00.000Z';
const candidate = (overrides: Partial<DueCandidate> = {}): DueCandidate => ({
  id: 'o30',
  contractId: 'c1',
  recipientId: 'cust-aino',
  eventVersion: 'end:2026-12-05',
  ruleId: 'd30',
  daysBefore: 30,
  dueAt: '2026-11-05T07:00:00.000Z',
  channels: ['in_app'],
  status: 'pending',
  nextAttemptAt: null,
  ...overrides,
});

describe('isDue', () => {
  it('is due exactly at the due time, not a moment before', () => {
    expect(isDue(candidate(), '2026-11-05T07:00:00.000Z')).toBe(true);
    expect(isDue(candidate(), '2026-11-05T06:59:59.999Z')).toBe(false);
  });
  it('skips sent, cancelled and backing-off reminders', () => {
    const now = '2026-11-06T00:00:00.000Z';
    expect(isDue(candidate({ status: 'covered' }), now)).toBe(false);
    expect(isDue(candidate({ status: 'cancelled' }), now)).toBe(false);
    expect(isDue(candidate({ nextAttemptAt: '2026-11-06T00:00:30.000Z' }), now)).toBe(false);
    expect(isDue(candidate({ nextAttemptAt: now }), now)).toBe(true);
  });
});

describe('checkEligibility', () => {
  const preferences = defaultReminderPreferences('Europe/Helsinki');
  it('accepts a reminder that still matches the lease and settings', () => {
    expect(checkEligibility(candidate(), { endOn: '2026-12-05', preferences })).toEqual({
      ok: true,
    });
  });
  it('rejects a changed end date, a removed or re-timed rule and switched-off reminders', () => {
    expect(checkEligibility(candidate(), { endOn: '2026-12-06', preferences }).ok).toBe(false);
    expect(
      checkEligibility(candidate({ ruleId: 'gone' }), { endOn: '2026-12-05', preferences })
    ).toEqual({ ok: false, reason: 'superseded' });
    expect(
      checkEligibility(candidate({ daysBefore: 29 }), { endOn: '2026-12-05', preferences }).ok
    ).toBe(false);
    expect(
      checkEligibility(candidate(), {
        endOn: '2026-12-05',
        preferences: { ...preferences, enabled: false },
      })
    ).toEqual({ ok: false, reason: 'disabled' });
  });
});

describe('groupDue', () => {
  it('groups by recipient, lease and event version', () => {
    const groups = groupDue([
      candidate({ id: 'a' }),
      candidate({ id: 'b', ruleId: 'd7' }),
      candidate({ id: 'c', contractId: 'c2' }),
      candidate({ id: 'd', recipientId: 'cust-lena' }),
    ]);
    expect(groups.map((group) => group.map((c) => c.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(groupDue([])).toEqual([]);
  });
});

describe('planNotification', () => {
  it('sends an on-time reminder as a normal one', () => {
    const plan = planNotification(
      [candidate()],
      '2026-11-05T07:00:30.000Z',
      deadline,
      'Europe/Helsinki'
    );
    expect(plan).toEqual({
      coveredIds: ['o30'],
      channels: ['in_app'],
      catchUp: false,
      originalDueAt: '2026-11-05T07:00:00.000Z',
      timing: { kind: 'days', days: 30 },
    });
  });
  it('turns missed 30- and 7-day reminders into one catch-up with the actual days left', () => {
    const plan = planNotification(
      [
        candidate({
          id: 'o7',
          ruleId: 'd7',
          daysBefore: 7,
          dueAt: '2026-11-27T07:00:00.000Z',
          channels: ['email'],
        }),
        candidate(),
      ],
      '2026-12-01T08:00:00.000Z',
      deadline,
      'Europe/Helsinki'
    );
    expect(plan).toMatchObject({
      coveredIds: ['o30', 'o7'],
      channels: ['in_app', 'email'],
      catchUp: true,
      originalDueAt: '2026-11-05T07:00:00.000Z',
      timing: { kind: 'days', days: 4 },
    });
  });
  it('marks a single late reminder as catch-up, and one after the deadline as ended', () => {
    const late = planNotification(
      [candidate()],
      '2026-11-05T07:11:00.000Z',
      deadline,
      'Europe/Helsinki'
    );
    expect(late?.catchUp).toBe(true);
    const ended = planNotification(
      [candidate()],
      '2026-12-06T07:00:00.000Z',
      deadline,
      'Europe/Helsinki'
    );
    expect(ended?.timing).toEqual({ kind: 'ended', days: 1 });
  });
  it('returns null for nothing due', () => {
    expect(planNotification([], '2026-11-05T07:00:00.000Z', deadline, 'UTC')).toBeNull();
  });
});

describe('retryDelaySeconds', () => {
  it('doubles from 30 seconds and stops at the cap', () => {
    expect([0, 1, 2, 3].map(retryDelaySeconds)).toEqual([30, 30, 60, 120]);
    expect(retryDelaySeconds(50)).toBe(MAX_RETRY_DELAY_SECONDS);
  });
});
