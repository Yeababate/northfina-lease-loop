import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_WINDOW_DAYS,
  availabilityOf,
  currentLeaseEndOn,
  matchesAvailability,
  parseAvailabilityFilter,
  plannedReadyOn,
  type Availability,
} from './catalogue-availability';

const TODAY = '2026-11-06';
const available = { status: 'available' } as const;
const reserved = { status: 'reserved' } as const;
const returned = { status: 'returned' } as const;

describe('currentLeaseEndOn', () => {
  it('is null with no leases', () => {
    expect(currentLeaseEndOn([])).toBeNull();
  });

  it('takes the latest planned end', () => {
    expect(
      currentLeaseEndOn([
        { endOn: '2026-12-01', actualEndOn: null },
        { endOn: '2027-03-01', actualEndOn: null },
        { endOn: '2026-01-01', actualEndOn: null },
      ])
    ).toBe('2027-03-01');
  });

  it('uses the actual end in place of the planned one', () => {
    expect(
      currentLeaseEndOn([
        { endOn: '2027-03-01', actualEndOn: '2026-10-15' },
        { endOn: '2026-12-01', actualEndOn: null },
      ])
    ).toBe('2026-12-01');
  });

  it('ignores invalid dates', () => {
    expect(currentLeaseEndOn([{ endOn: 'soon', actualEndOn: null }])).toBeNull();
    expect(
      currentLeaseEndOn([
        { endOn: '2026-12-01', actualEndOn: '2026-02-30' },
        { endOn: '2026-11-20', actualEndOn: null },
      ])
    ).toBe('2026-11-20');
  });
});

describe('plannedReadyOn', () => {
  it('is today for an available item, whatever its lease history', () => {
    expect(plannedReadyOn(available, null, TODAY)).toBe(TODAY);
    expect(plannedReadyOn(available, '2027-01-01', TODAY)).toBe(TODAY);
  });

  it('is the lease end when that is later than today', () => {
    expect(plannedReadyOn(reserved, '2026-11-20', TODAY)).toBe('2026-11-20');
    expect(plannedReadyOn(returned, '2026-11-07', TODAY)).toBe('2026-11-07');
  });

  it('is today when the lease has already ended or ends today', () => {
    expect(plannedReadyOn(returned, '2026-10-01', TODAY)).toBe(TODAY);
    expect(plannedReadyOn(reserved, TODAY, TODAY)).toBe(TODAY);
  });

  it('is today for a returned item with no lease on record', () => {
    expect(plannedReadyOn(returned, null, TODAY)).toBe(TODAY);
  });

  it('has no date for a reserved item with no lease on record', () => {
    expect(plannedReadyOn(reserved, null, TODAY)).toBeNull();
    expect(plannedReadyOn(reserved, 'not-a-date', TODAY)).toBeNull();
  });

  it('rejects an invalid today', () => {
    expect(() => plannedReadyOn(available, null, '06.11.2026')).toThrow(RangeError);
  });
});

describe('availabilityOf', () => {
  it('is "now" only for available items', () => {
    expect(availabilityOf(available, null, TODAY)).toEqual({ kind: 'now' });
  });

  it('counts the days to the ready date', () => {
    expect(availabilityOf(reserved, '2026-11-13', TODAY)).toEqual({
      kind: 'soon',
      readyOn: '2026-11-13',
      days: 7,
    });
  });

  it('says 0 days for a returned item that is planned for today', () => {
    expect(availabilityOf(returned, null, TODAY)).toEqual({
      kind: 'soon',
      readyOn: TODAY,
      days: 0,
    });
  });

  it('keeps the window edge inside and the next day outside', () => {
    expect(availabilityOf(reserved, '2026-12-06', TODAY)).toMatchObject({
      kind: 'soon',
      days: AVAILABILITY_WINDOW_DAYS,
    });
    expect(availabilityOf(reserved, '2026-12-07', TODAY)).toMatchObject({
      kind: 'later',
      days: AVAILABILITY_WINDOW_DAYS + 1,
    });
  });

  it('counts across a month and year end', () => {
    expect(availabilityOf(reserved, '2027-01-02', '2026-12-30')).toMatchObject({ days: 3 });
  });

  it('is unknown for a reserved item with no lease', () => {
    expect(availabilityOf(reserved, null, TODAY)).toEqual({ kind: 'unknown' });
  });
});

describe('matchesAvailability', () => {
  const now: Availability = { kind: 'now' };
  const inZero: Availability = { kind: 'soon', readyOn: TODAY, days: 0 };
  const inSeven: Availability = { kind: 'soon', readyOn: '2026-11-13', days: 7 };
  const inEight: Availability = { kind: 'soon', readyOn: '2026-11-14', days: 8 };
  const inThirty: Availability = { kind: 'soon', readyOn: '2026-12-06', days: 30 };
  const later: Availability = { kind: 'later', readyOn: '2027-06-01', days: 207 };
  const unknown: Availability = { kind: 'unknown' };

  it('keeps everything with no filter', () => {
    for (const a of [now, inZero, inSeven, later, unknown])
      expect(matchesAvailability(a, null)).toBe(true);
  });

  it('"now" keeps only leasable items, not ones merely planned for today', () => {
    expect(matchesAvailability(now, 'now')).toBe(true);
    expect(matchesAvailability(inZero, 'now')).toBe(false);
    expect(matchesAvailability(unknown, 'now')).toBe(false);
  });

  it('"7" keeps items ready within 7 days, inclusive', () => {
    expect(matchesAvailability(now, '7')).toBe(true);
    expect(matchesAvailability(inZero, '7')).toBe(true);
    expect(matchesAvailability(inSeven, '7')).toBe(true);
    expect(matchesAvailability(inEight, '7')).toBe(false);
  });

  it('"30" keeps the whole window but not later or unknown items', () => {
    expect(matchesAvailability(inEight, '30')).toBe(true);
    expect(matchesAvailability(inThirty, '30')).toBe(true);
    expect(matchesAvailability(later, '30')).toBe(false);
    expect(matchesAvailability(unknown, '30')).toBe(false);
  });
});

describe('parseAvailabilityFilter', () => {
  it('reads the known values', () => {
    expect(parseAvailabilityFilter({ avail: 'now' })).toBe('now');
    expect(parseAvailabilityFilter({ avail: ' 7 ' })).toBe('7');
    expect(parseAvailabilityFilter({ avail: ['30', 'now'] })).toBe('30');
  });

  it('treats missing or unknown values as no filter', () => {
    expect(parseAvailabilityFilter({})).toBeNull();
    expect(parseAvailabilityFilter({ avail: '' })).toBeNull();
    expect(parseAvailabilityFilter({ avail: '14' })).toBeNull();
  });
});
