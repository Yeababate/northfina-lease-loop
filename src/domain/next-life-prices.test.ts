import { describe, expect, it } from 'vitest';
import type { PriceList } from '@/data/schemas';
import { listPriceOn } from './price-list';
import { withNextLifePrices } from './next-life-prices';

const lists: PriceList[] = [
  {
    version: 1,
    valid_from: '2026-01-01',
    valid_to: '2026-11-05',
    note: '',
    prices: { a: 549_000, b: 100 },
  },
  {
    version: 2,
    valid_from: '2026-11-06',
    valid_to: null,
    note: '',
    prices: { a: 576_450, b: 100 },
  },
];

describe('withNextLifePrices', () => {
  it('uses the next-life price from the relisting day, keeping the list version', () => {
    const priced = withNextLifePrices(lists, [
      { assetId: 'a', priceCents: 151_661, validFrom: '2026-11-06' },
    ]);
    expect(listPriceOn(priced, 'a', '2026-11-06')).toEqual({
      ok: true,
      priceCents: 151_661,
      priceListVersion: 2,
    });
    expect(listPriceOn(priced, 'b', '2026-11-06')).toMatchObject({ priceCents: 100 });
  });

  it('leaves lists that ended before the relisting alone', () => {
    const priced = withNextLifePrices(lists, [
      { assetId: 'a', priceCents: 151_661, validFrom: '2026-11-06' },
    ]);
    expect(listPriceOn(priced, 'a', '2026-11-05')).toMatchObject({ priceCents: 549_000 });
  });

  it('takes the latest relisting of an item', () => {
    const priced = withNextLifePrices(lists, [
      { assetId: 'a', priceCents: 90_000, validFrom: '2027-03-01' },
      { assetId: 'a', priceCents: 151_661, validFrom: '2026-11-06' },
    ]);
    expect(listPriceOn(priced, 'a', '2027-04-01')).toMatchObject({ priceCents: 90_000 });
  });

  it('returns the lists unchanged without next-life prices, and rejects fractions', () => {
    expect(withNextLifePrices(lists, [])).toEqual(lists);
    expect(() =>
      withNextLifePrices(lists, [{ assetId: 'a', priceCents: 1.5, validFrom: '2026-11-06' }])
    ).toThrow(RangeError);
  });
});
