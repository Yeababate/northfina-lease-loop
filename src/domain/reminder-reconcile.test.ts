import { describe, expect, it } from 'vitest';
import { reconcileOccurrences, type SavedOccurrence } from './reminder-reconcile';
import type { PlannedOccurrence } from './reminder-schedule';

const planned = (
  key: string,
  state: PlannedOccurrence['state'] = 'scheduled'
): PlannedOccurrence => ({
  key,
  ruleId: key,
  daysBefore: 7,
  localDate: '2026-11-28',
  localTime: '10:00',
  timeZone: 'Europe/Helsinki',
  dueAt: '2026-11-28T08:00:00.000Z',
  adjustment: 'none',
  channels: ['in_app'],
  state,
});
const saved = (id: string, key: string, status: SavedOccurrence['status']): SavedOccurrence => ({
  id,
  key,
  status,
});

describe('reconcileOccurrences', () => {
  it('creates new occurrences, pending or skipped when already past', () => {
    expect(reconcileOccurrences([], [planned('a'), planned('b', 'already_past')])).toEqual([
      { kind: 'create', planned: planned('a'), status: 'pending' },
      { kind: 'create', planned: planned('b', 'already_past'), status: 'skipped_past' },
    ]);
  });
  it('moves a pending occurrence to its new time instead of adding a second one', () => {
    expect(reconcileOccurrences([saved('1', 'a', 'pending')], [planned('a')])).toEqual([
      { kind: 'update', id: '1', planned: planned('a'), status: 'pending' },
    ]);
  });
  it('never touches or resends a delivered occurrence', () => {
    expect(reconcileOccurrences([saved('1', 'a', 'covered')], [planned('a')])).toEqual([
      { kind: 'keep', id: '1' },
    ]);
    expect(reconcileOccurrences([saved('1', 'a', 'covered')], [])).toEqual([
      { kind: 'keep', id: '1' },
    ]);
  });
  it('cancels pending occurrences that left the plan and keeps cancelled history', () => {
    expect(
      reconcileOccurrences([saved('1', 'a', 'pending'), saved('2', 'b', 'cancelled')], [])
    ).toEqual([
      { kind: 'cancel', id: '1' },
      { kind: 'keep', id: '2' },
    ]);
  });
  it('reactivates a cancelled occurrence that comes back into the plan', () => {
    expect(reconcileOccurrences([saved('2', 'b', 'cancelled')], [planned('b')])).toEqual([
      { kind: 'update', id: '2', planned: planned('b'), status: 'pending' },
    ]);
  });
});
