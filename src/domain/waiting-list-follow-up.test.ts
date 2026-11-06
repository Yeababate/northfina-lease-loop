import { describe, expect, it } from 'vitest';
import {
  canAnswerStillWanted,
  checkNewNeededBy,
  expectedReceivingDate,
  followUpStep,
  neededByPassed,
  replyLastDay,
  REPLY_DAYS,
} from './waiting-list-follow-up';

const waiting = { status: 'waiting', neededBy: '2026-11-30', stillWantedAskedOn: null };
const asked = { ...waiting, stillWantedAskedOn: '2026-12-01' };

describe('neededByPassed', () => {
  it('is false on the needed-by day itself and true from the day after', () => {
    expect(neededByPassed('2026-11-30', '2026-11-29')).toBe(false);
    expect(neededByPassed('2026-11-30', '2026-11-30')).toBe(false);
    expect(neededByPassed('2026-11-30', '2026-12-01')).toBe(true);
  });

  it('crosses month and year ends', () => {
    expect(neededByPassed('2026-12-31', '2027-01-01')).toBe(true);
    expect(neededByPassed('2027-02-28', '2027-03-01')).toBe(true);
  });
});

describe('replyLastDay', () => {
  it(`is ${REPLY_DAYS} days after the day asked`, () => {
    expect(replyLastDay('2026-12-01')).toBe('2026-12-15');
  });

  it('crosses month ends and leap days', () => {
    expect(replyLastDay('2026-12-20')).toBe('2027-01-03');
    expect(replyLastDay('2028-02-20')).toBe('2028-03-05'); // 2028 has 29 February
    expect(replyLastDay('2027-02-20')).toBe('2027-03-06');
    expect(replyLastDay('2028-02-15')).toBe('2028-02-29');
  });
});

describe('followUpStep', () => {
  it('waits on the needed-by day and asks the day after', () => {
    expect(followUpStep(waiting, '2026-11-30')).toBe('none');
    expect(followUpStep(waiting, '2026-12-01')).toBe('ask');
  });

  it('still asks when the follow-up runs late (e.g. the server was down)', () => {
    expect(followUpStep(waiting, '2027-01-20')).toBe('ask');
  });

  it('keeps an asked entry through day 14 and expires it on day 15', () => {
    expect(followUpStep(asked, '2026-12-01')).toBe('none');
    expect(followUpStep(asked, '2026-12-15')).toBe('none'); // day 14
    expect(followUpStep(asked, '2026-12-16')).toBe('expire'); // day 15
  });

  it('counts the 14 days over a leap day', () => {
    const leap = { ...waiting, neededBy: '2028-02-19', stillWantedAskedOn: '2028-02-20' };
    expect(followUpStep(leap, '2028-03-05')).toBe('none');
    expect(followUpStep(leap, '2028-03-06')).toBe('expire');
  });

  it('leaves offered, matched and expired entries alone', () => {
    for (const status of ['offered', 'matched', 'expired'])
      expect(followUpStep({ ...asked, status }, '2027-06-01')).toBe('none');
  });
});

describe('canAnswerStillWanted', () => {
  it('opens the day after needed-by, even before the message has gone out', () => {
    expect(canAnswerStillWanted(waiting, '2026-11-30')).toBe(false);
    expect(canAnswerStillWanted(waiting, '2026-12-01')).toBe(true);
  });

  it('closes after the last reply day', () => {
    expect(canAnswerStillWanted(asked, '2026-12-15')).toBe(true);
    expect(canAnswerStillWanted(asked, '2026-12-16')).toBe(false);
  });

  it('is closed for an entry that is not waiting', () => {
    expect(canAnswerStillWanted({ ...asked, status: 'expired' }, '2026-12-02')).toBe(false);
    expect(canAnswerStillWanted({ ...asked, status: 'offered' }, '2026-12-02')).toBe(false);
  });
});

describe('checkNewNeededBy', () => {
  it('needs a day strictly after today', () => {
    expect(checkNewNeededBy('2026-12-01', '2026-12-01')).toEqual({
      ok: false,
      problem: 'not_in_future',
    });
    expect(checkNewNeededBy('2026-11-30', '2026-12-01')).toEqual({
      ok: false,
      problem: 'not_in_future',
    });
    expect(checkNewNeededBy('2026-12-02', '2026-12-01')).toEqual({ ok: true });
  });

  it('accepts a leap day only in a leap year, and rejects impossible dates', () => {
    expect(checkNewNeededBy('2028-02-29', '2026-12-01')).toEqual({ ok: true });
    expect(checkNewNeededBy('2027-02-29', '2026-12-01')).toEqual({
      ok: false,
      problem: 'not_a_date',
    });
    expect(checkNewNeededBy('2026-11-31', '2026-11-01')).toEqual({
      ok: false,
      problem: 'not_a_date',
    });
    expect(checkNewNeededBy('soon', '2026-11-01')).toEqual({ ok: false, problem: 'not_a_date' });
  });

  it('accepts the first day of the next year', () => {
    expect(checkNewNeededBy('2027-01-01', '2026-12-31')).toEqual({ ok: true });
  });
});

describe('expectedReceivingDate', () => {
  it('is today when there is no lease to wait for', () => {
    expect(expectedReceivingDate('2026-11-06', null)).toBe('2026-11-06');
  });

  it('is the later of today and the lease end', () => {
    expect(expectedReceivingDate('2026-11-06', '2026-12-31')).toBe('2026-12-31');
    expect(expectedReceivingDate('2026-11-06', '2026-10-01')).toBe('2026-11-06');
  });

  it('is today when the lease ends today', () => {
    expect(expectedReceivingDate('2026-11-06', '2026-11-06')).toBe('2026-11-06');
  });
});
