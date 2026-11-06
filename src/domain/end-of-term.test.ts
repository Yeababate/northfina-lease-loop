import { expect, it } from 'vitest';
import { loadVatRates } from '@/data/load';
import { endOfTermBuyout, endOfTermOptions } from './end-of-term';
import { previewEarlyExit } from './early-exit';

it('opens the last 30 days and quotes exactly the locked net buyout plus the daily VAT', async () => {
  const vat = await loadVatRates();
  const lease = {
    id: 'lease',
    renterId: 'renter',
    providerId: 'provider',
    status: 'active',
    startOn: '2026-01-01',
    endOn: '2027-01-01',
    termMonths: 12,
    monthlyNetCents: 10_730,
    buyoutNetCents: 58_350,
    revision: 0,
  };
  expect(endOfTermOptions(lease, '2026-12-01', vat)).toMatchObject({
    available: false,
    opensOn: '2026-12-02',
  });
  expect(endOfTermOptions(lease, '2026-12-02', vat)).toMatchObject({ available: true });
  const finalMonth = previewEarlyExit(lease, 'buyout', 'renter', '2026-12-31');
  expect(finalMonth).toMatchObject({ ok: true, quote: { amountNetCents: 58_350 } });
  expect(endOfTermOptions(lease, '2027-01-01', vat)).toMatchObject({
    options: {
      end_buyout: { netCents: 58_350, vatCents: 15_171, grossCents: 73_521 },
      end_return: { grossCents: 0 },
      pass_on: { requiresNewContract: true },
    },
  });
  expect(endOfTermOptions(lease, '2027-01-02', vat).available).toBe(false);
});

it('keeps free return and pass-on available when no VAT rate can price a buyout', async () => {
  const vat = { ...(await loadVatRates()), rates: [] };
  expect(endOfTermBuyout(58_350, '2027-01-01', vat)).toMatchObject({ ok: false });
  const lease = { endOn: '2027-01-01', status: 'active', buyoutNetCents: 58_350 };
  expect(endOfTermOptions(lease, '2027-01-01', vat)).toMatchObject({
    available: true,
    options: {
      end_buyout: null,
      end_return: { grossCents: 0 },
      pass_on: { requiresNewContract: true },
    },
  });
  expect(
    endOfTermOptions({ ...lease, status: 'completed_buyout' }, '2027-01-01', vat)
  ).toMatchObject({
    available: false,
    options: null,
  });
});
