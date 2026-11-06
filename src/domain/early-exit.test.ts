import { describe, expect, it } from 'vitest';
import vatRates from '../../data/vat-rates.json';
import {
  isFairExitQuote,
  legacyExitMethod,
  previewEarlyExit,
  returnCanComplete,
  sameExitQuote,
  type ExitContract,
  type ExitPricing,
  type ExitQuote,
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

const valued = {
  assetId: 'ebike-003',
  basis: 'assumed' as const,
  condition: 'good' as const,
  usageUnit: 'km' as const,
  usageValue: 0,
  ageMonths: 7,
  marketValueCents: 264520,
};
const valuedOn: string[] = [];
const pricing: ExitPricing = {
  annualInterestPercent: 7.9,
  vatRates: vatRates.rates,
  valueReturn: (on) => {
    valuedOn.push(on);
    return { ok: true, marketValueCents: 264520, items: [valued] };
  },
};
const preview = (c: ExitContract, kind: 'return' | 'buyout', user: string, on: string) =>
  previewEarlyExit(c, kind, user, on, pricing);

describe('early-exit quote', () => {
  it('quotes current-period-end exit with fair-exit-v2', () => {
    expect(preview(contract, 'return', 'renter', '2026-07-31')).toMatchObject({
      ok: true,
      quote: {
        effectiveEndOn: '2026-08-31',
        elapsedMonths: 7,
        remainingMonths: 29,
        amountNetCents: 68005,
        method: 'fair-exit-v2',
        contractRevision: 0,
        breakdown: {
          buyoutValueCents: 332525,
          marketValueCreditCents: 264520,
          vatRatePercent: 25.5,
        },
      },
    });
    // The item is valued on the exit date, when the provider gets it back.
    expect(valuedOn.at(-1)).toBe('2026-08-31');
    expect(preview(contract, 'buyout', 'renter', '2026-07-31')).toMatchObject({
      ok: true,
      quote: { amountNetCents: 332525, breakdown: { marketValueCents: 0, valuedItems: [] } },
    });
  });
  it('uses the VAT rate of the exit date', () => {
    const result = preview(contract, 'buyout', 'renter', '2027-01-31');
    expect(result).toMatchObject({ ok: true, quote: { breakdown: { vatRatePercent: 26 } } });
  });
  it('cannot price without the band rate, a VAT rate or a market value', () => {
    expect(
      previewEarlyExit(contract, 'buyout', 'renter', '2026-07-31', {
        ...pricing,
        annualInterestPercent: null,
      })
    ).toEqual({ ok: false, reason: 'price_unavailable' });
    expect(
      previewEarlyExit(contract, 'buyout', 'renter', '2026-07-31', { ...pricing, vatRates: [] })
    ).toEqual({ ok: false, reason: 'price_unavailable' });
    const noValue: ExitPricing = {
      ...pricing,
      valueReturn: () => ({ ok: false, reason: 'market_value_unavailable' }),
    };
    expect(previewEarlyExit(contract, 'return', 'renter', '2026-07-31', noValue)).toEqual({
      ok: false,
      reason: 'price_unavailable',
    });
    expect(previewEarlyExit(contract, 'buyout', 'renter', '2026-07-31', noValue)).toMatchObject({
      ok: true,
    });
  });
  it('charges exactly the signed buyout in the final month', () => {
    expect(preview(contract, 'buyout', 'renter', '2029-01-30')).toMatchObject({
      ok: true,
      quote: { remainingMonths: 0, amountNetCents: 58350 },
    });
  });
  it('keeps stored v1 quotes recognisable so they are explained with v1', () => {
    const stored: ExitQuote = {
      contractId: 'contract-1',
      kind: 'return',
      effectiveEndOn: '2026-08-31',
      periodStartOn: '2026-07-31',
      elapsedMonths: 7,
      remainingMonths: 29,
      monthlyRentCents: 10730,
      amountNetCents: 155585,
      method: legacyExitMethod('return'),
      contractRevision: 0,
    };
    expect(stored.method).toBe('half-remaining-rent-v1');
    expect(legacyExitMethod('buyout')).toBe('remaining-rent-plus-buyout-v1');
    expect(isFairExitQuote(stored)).toBe(false);
    const fresh = preview(contract, 'return', 'renter', '2026-07-31');
    if (!fresh.ok) throw new Error('Expected quote');
    expect(isFairExitQuote(fresh.quote)).toBe(true);
    expect(sameExitQuote(stored, fresh.quote)).toBe(false);
  });
  it('does not authorize the provider, strangers or unresolved legacy participants', () => {
    expect(preview(contract, 'return', 'provider', '2026-07-31')).toMatchObject({
      reason: 'not_renter',
    });
    expect(
      preview({ ...contract, renterId: null }, 'return', 'renter', '2026-07-31')
    ).toMatchObject({ reason: 'participants_missing' });
    expect(
      preview({ ...contract, status: 'completed_return' }, 'return', 'renter', '2026-07-31')
    ).toMatchObject({ reason: 'not_active' });
    expect(preview(contract, 'return', 'renter', '2026-01-01')).toMatchObject({
      reason: 'not_started',
    });
    expect(preview(contract, 'return', 'renter', '2029-01-31')).toMatchObject({
      reason: 'already_ended',
    });
  });
  it('requires re-review of any changed quote value or revision', () => {
    const result = preview(contract, 'return', 'renter', '2026-07-31');
    if (!result.ok || !result.quote.breakdown) throw new Error('Expected quote');
    expect(sameExitQuote(result.quote, { ...result.quote })).toBe(true);
    for (const change of [
      { amountNetCents: 1 },
      { method: 'v2' },
      { contractRevision: 1 },
      { effectiveEndOn: '2026-09-30' },
      { breakdown: { ...result.quote.breakdown, vatCents: 1 } },
      { breakdown: undefined },
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
