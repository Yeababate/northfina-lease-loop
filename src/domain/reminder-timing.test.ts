import { describe, expect, it } from 'vitest';
import { timeRemaining } from './reminder-timing';

const deadline = '2026-12-04T22:00:00.000Z'; // 00:00 on 5 Dec in Helsinki

describe('timeRemaining', () => {
  it('counts calendar days in the recipient zone', () => {
    expect(timeRemaining('2026-12-02T07:00:00.000Z', deadline, 'Europe/Helsinki')).toEqual({
      kind: 'days',
      days: 3,
    });
    expect(timeRemaining('2026-12-04T21:59:00.000Z', deadline, 'Europe/Helsinki')).toEqual({
      kind: 'days',
      days: 1,
    });
  });
  it('gives hours when the deadline is later the same local day', () => {
    expect(timeRemaining('2026-12-04T09:00:00.000Z', deadline, 'Europe/London')).toEqual({
      kind: 'hours',
      hours: 13,
    });
    expect(timeRemaining('2026-12-04T21:59:30.000Z', deadline, 'Europe/London')).toEqual({
      kind: 'hours',
      hours: 1,
    });
  });
  it('says ended at and after the deadline, never a negative day count', () => {
    expect(timeRemaining(deadline, deadline, 'Europe/Helsinki')).toEqual({
      kind: 'ended',
      days: 0,
    });
    expect(timeRemaining('2026-12-07T10:00:00.000Z', deadline, 'Europe/Helsinki')).toEqual({
      kind: 'ended',
      days: 2,
    });
  });
});
