import { describe, expect, it } from 'vitest';
import {
  previewEarlyExit,
  returnCanComplete,
  sameExitQuote,
  type ExitContract,
} from './early-exit';

const contract: ExitContract = {
  id: 'contract-1',
  renterId: 'renter',
  providerId: 'provider',
  startOn: '2026-01-31',
  endOn: '2029-01-31',
  termMonths: 36,
  monthlyNetCents: 10730,
  buyoutNetCents: 58350,
  status: 'active',
  revision: 0,
};

describe('early-exit quote', () => {
  it('quotes current-period-end exit from saved terms', () => {
    expect(previewEarlyExit(contract, 'return', 'renter', '2026-07-31')).toMatchObject({
      ok: true,
      quote: {
        effectiveEndOn: '2026-08-31',
        elapsedMonths: 7,
        remainingMonths: 29,
        amountNetCents: 155585,
        contractRevision: 0,
      },
    });
    expect(previewEarlyExit(contract, 'buyout', 'renter', '2026-07-31')).toMatchObject({
      ok: true,
      quote: { amountNetCents: 369520 },
    });
  });
  it('supports a replacement calculation without changing consumers', () => {
    expect(
      previewEarlyExit(contract, 'return', 'renter', '2026-07-31', {
        cancellation: (input) => input.elapsedMonths * 100,
        buyout: () => 500,
        cancellationMethod: 'custom-return',
        buyoutMethod: 'custom-buyout',
      })
    ).toMatchObject({ ok: true, quote: { amountNetCents: 700, method: 'custom-return' } });
    expect(() =>
      previewEarlyExit(contract, 'buyout', 'renter', '2026-07-31', {
        cancellation: () => 0,
        buyout: () => -1,
        cancellationMethod: 'custom',
        buyoutMethod: 'invalid',
      })
    ).toThrow(RangeError);
  });
  it('does not authorize the provider, strangers or unresolved legacy participants', () => {
    expect(previewEarlyExit(contract, 'return', 'provider', '2026-07-31')).toMatchObject({
      reason: 'not_renter',
    });
    expect(
      previewEarlyExit({ ...contract, renterId: null }, 'return', 'renter', '2026-07-31')
    ).toMatchObject({ reason: 'participants_missing' });
    expect(
      previewEarlyExit(
        { ...contract, status: 'completed_return' },
        'return',
        'renter',
        '2026-07-31'
      )
    ).toMatchObject({ reason: 'not_active' });
    expect(previewEarlyExit(contract, 'return', 'renter', '2026-01-01')).toMatchObject({
      reason: 'not_started',
    });
    expect(previewEarlyExit(contract, 'return', 'renter', '2029-01-31')).toMatchObject({
      reason: 'already_ended',
    });
  });
  it('requires re-review of any changed quote value or revision', () => {
    const result = previewEarlyExit(contract, 'return', 'renter', '2026-07-31');
    if (!result.ok) throw new Error('Expected quote');
    expect(sameExitQuote(result.quote, { ...result.quote })).toBe(true);
    for (const change of [
      { amountNetCents: 1 },
      { method: 'v2' },
      { contractRevision: 1 },
      { effectiveEndOn: '2026-09-30' },
    ]) {
      expect(sameExitQuote(result.quote, { ...result.quote, ...change })).toBe(false);
    }
  });
});

it('requires every physical item, balances reviewed and period end for return completion', () => {
  const ids = ['a', 'b'];
  expect(returnCanComplete('2026-08-31', ids, ['a'], true, '2026-08-31')).toBe(false);
  expect(returnCanComplete('2026-08-31', ids, ids, true, '2026-08-30')).toBe(false);
  expect(returnCanComplete('2026-08-31', ids, ids, false, '2026-08-31')).toBe(false);
  expect(returnCanComplete('2026-08-31', [], [], true, '2026-08-31')).toBe(false);
  expect(returnCanComplete('2026-08-31', ['a', 'a'], ['a'], true, '2026-08-31')).toBe(false);
  expect(returnCanComplete('2026-08-31', ids, ids, true, '2026-08-31')).toBe(true);
  expect(returnCanComplete('2026-08-31', ids, ids, true, '2026-09-01')).toBe(true);
});
