import { describe, expect, it } from 'vitest';
import type { VatRate } from '@/data/schemas';
import vatRates from '../../data/vat-rates.json';
import {
  legacyExitMethod,
  previewEarlyExit,
  type ExitContract,
  type ExitPricing,
  type ExitQuote,
} from './early-exit';
import {
  exitCharge,
  exitPriceChange,
  freezeExitQuote,
  repriceExitRequest,
} from './exit-settlement';
import type { ValuedItem } from './fair-exit-valuation';

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
const assumed: ValuedItem = {
  assetId: 'ebike-003',
  basis: 'assumed',
  condition: 'good',
  usageUnit: 'km',
  usageValue: 0,
  ageMonths: 7,
  marketValueCents: 264520,
};
const inspected: ValuedItem = {
  ...assumed,
  basis: 'inspected',
  condition: 'fair',
  usageValue: 1500,
  marketValueCents: 198234,
};
const pricingWith = (
  item: ValuedItem,
  rates: readonly VatRate[] = vatRates.rates
): ExitPricing => ({
  annualInterestPercent: 7.9,
  vatRates: rates,
  valueReturn: () => ({ ok: true, marketValueCents: item.marketValueCents, items: [item] }),
});

function storedReturn(): ExitQuote {
  const result = previewEarlyExit(contract, 'return', 'renter', '2026-07-31', pricingWith(assumed));
  if (!result.ok) throw new Error('Expected quote');
  return result.quote;
}

describe('re-pricing an open exit request', () => {
  it('re-prices with an inspection made after the request, keeping period and revision', () => {
    const stored = storedReturn();
    // The request bumped the contract revision; the stored period still applies.
    const later = { ...contract, revision: 1 };
    const result = repriceExitRequest(later, stored, pricingWith(inspected));
    expect(result).toMatchObject({
      ok: true,
      quote: {
        effectiveEndOn: stored.effectiveEndOn,
        remainingMonths: 29,
        amountNetCents: 332525 - 198234,
        contractRevision: stored.contractRevision,
      },
    });
    if (!result.ok) throw new Error('Expected quote');
    expect(exitPriceChange(stored, result.quote)).toEqual({
      reason: 'inspection',
      previousNetCents: 68005,
    });
  });

  it('reprices even after the request month has passed (completion runs on the exit date)', () => {
    const stored = storedReturn();
    expect(repriceExitRequest(contract, stored, pricingWith(assumed))).toEqual({
      ok: true,
      quote: stored,
    });
  });

  it('keeps frozen and v1 quotes unchanged', () => {
    const frozen = freezeExitQuote(storedReturn(), '2026-08-31');
    expect(frozen.frozenOn).toBe('2026-08-31');
    expect(freezeExitQuote(frozen, '2026-09-30')).toBe(frozen);
    expect(repriceExitRequest(contract, frozen, pricingWith(inspected))).toEqual({
      ok: true,
      quote: frozen,
    });
    const { breakdown: _ignored, ...rest } = storedReturn();
    const v1: ExitQuote = { ...rest, method: legacyExitMethod('return'), amountNetCents: 155585 };
    expect(repriceExitRequest(contract, v1, pricingWith(inspected))).toEqual({
      ok: true,
      quote: v1,
    });
  });

  it('reports when the current data cannot price the request', () => {
    expect(
      repriceExitRequest(contract, storedReturn(), { ...pricingWith(assumed), vatRates: [] })
    ).toEqual({ ok: false, reason: 'price_unavailable' });
  });
});

describe('exitPriceChange', () => {
  const stored = storedReturn();
  const priced = (item: ValuedItem, rates: readonly VatRate[] = vatRates.rates) => {
    const result = repriceExitRequest(contract, stored, pricingWith(item, rates));
    if (!result.ok) throw new Error('Expected quote');
    return result.quote;
  };

  it('names why the price moved, or returns null when it did not', () => {
    expect(exitPriceChange(stored, stored)).toBeNull();
    expect(exitPriceChange(stored, priced({ ...assumed, marketValueCents: 1 }))).toMatchObject({
      reason: 'valuation',
    });
    const withInspection = priced(inspected);
    expect(exitPriceChange(withInspection, withInspection)).toBeNull();
    expect(
      exitPriceChange(withInspection, priced({ ...inspected, condition: 'poor' }))
    ).toMatchObject({ reason: 'inspection' });
    const vat26 = [{ rate_percent: 26, valid_from: '2000-01-01', valid_to: null }];
    expect(exitPriceChange(stored, priced(assumed, vat26))).toEqual({
      reason: 'vat',
      previousNetCents: 68005,
    });
    expect(
      exitPriceChange(stored, { ...stored, breakdown: { ...stored.breakdown!, netCents: 1 } })
    ).toMatchObject({ reason: 'price' });
  });

  it('compares v1 quotes by amount only', () => {
    const v1: ExitQuote = { ...stored, method: legacyExitMethod('return'), breakdown: undefined };
    expect(exitPriceChange(v1, v1)).toBeNull();
    expect(exitPriceChange(v1, { ...v1, amountNetCents: 1 })).toMatchObject({ reason: 'price' });
  });
});

describe('exitCharge', () => {
  it('keeps the frozen net and adds VAT at the invoice date, so only the gross changes', () => {
    const before = exitCharge(68005, vatRates.rates, '2026-12-31');
    const after = exitCharge(68005, vatRates.rates, '2027-01-01');
    expect(before).toEqual({
      ok: true,
      charge: {
        netCents: 68005,
        vatRatePercent: 25.5,
        vatCents: 17341,
        grossCents: 85346,
        invoiceOn: '2026-12-31',
      },
    });
    expect(after).toMatchObject({
      ok: true,
      charge: { netCents: 68005, vatRatePercent: 26, vatCents: 17681, grossCents: 85686 },
    });
  });

  it('reports a date with no VAT rate', () => {
    expect(exitCharge(1, vatRates.rates, '2000-01-01')).toEqual({
      ok: false,
      reason: 'no_rate_on_date',
    });
  });
});
