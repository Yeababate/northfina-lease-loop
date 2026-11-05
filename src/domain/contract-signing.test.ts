import { beforeAll, expect, it } from 'vitest';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { minDownPaymentCents } from './pricing';
import { contractSigningState } from './contract-signing';

let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
let vat: Awaited<ReturnType<typeof loadVatRates>>;
const input = { assetId: 'ebike-003', termMonths: 36, downPaymentCents: 0 };
beforeAll(async () => {
  [lists, table, vat] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
});

it('becomes signable after entering a valid name and recovers after loading', () => {
  const state = (actor: string, busy = false) =>
    contractSigningState(lists, table, vat, input, '2026-11-05', actor, busy);
  expect(state('')).toMatchObject({ canSign: false, reason: 'actor_required' });
  expect(state('   ')).toMatchObject({ canSign: false, reason: 'actor_required' });
  expect(state('a'.repeat(101))).toMatchObject({ canSign: false, reason: 'actor_required' });
  expect(state(' Aino ')).toMatchObject({ canSign: true, reason: null });
  expect(state('Aino', true)).toMatchObject({ canSign: false, reason: 'busy' });
  expect(state('Aino', false)).toMatchObject({ canSign: true, reason: null });
});

it('reproduces zero-down failure and accepts the calculator choices for an expensive asset', () => {
  const farm = { assetId: 'farm-006', termMonths: 48, downPaymentCents: 0 };
  expect(contractSigningState(lists, table, vat, farm, '2026-11-05', 'Aino', false)).toMatchObject({
    canSign: false,
    reason: 'above_maximum',
  });
  const downPaymentCents = minDownPaymentCents(table, lists[0]!.prices['farm-006']!);
  expect(downPaymentCents).toBe(1000000);
  expect(
    contractSigningState(
      lists,
      table,
      vat,
      { ...farm, downPaymentCents },
      '2026-11-05',
      'Aino',
      false
    )
  ).toMatchObject({
    canSign: true,
    quote: { ok: true, price: { termMonths: 48, downPaymentCents: 1000000 } },
  });
});

it.each([NaN, 0.5, -1, 389001])(
  'keeps invalid down payment %s blocked even with a name',
  (downPaymentCents) => {
    expect(
      contractSigningState(
        lists,
        table,
        vat,
        { ...input, downPaymentCents },
        '2026-11-05',
        'Aino',
        false
      )
    ).toMatchObject({ canSign: false, reason: 'invalid_down_payment' });
  }
);

it('explains minimum finance, unsupported term, missing pricing and VAT', () => {
  expect(
    contractSigningState(
      lists,
      table,
      vat,
      { ...input, downPaymentCents: 389000 },
      '2026-11-05',
      'Aino',
      false
    ).reason
  ).toBe('below_minimum');
  expect(
    contractSigningState(
      lists,
      table,
      vat,
      { ...input, termMonths: 13 },
      '2026-11-05',
      'Aino',
      false
    ).reason
  ).toBe('unknown_term');
  expect(contractSigningState([], table, vat, input, '2026-11-05', 'Aino', false).reason).toBe(
    'no_price_list_on_date'
  );
  expect(
    contractSigningState(
      lists,
      table,
      vat,
      { ...input, assetId: 'missing' },
      '2026-11-05',
      'Aino',
      false
    ).reason
  ).toBe('unknown_asset');
  expect(
    contractSigningState(
      lists,
      { ...table, valid_from: '2027-01-01' },
      vat,
      input,
      '2026-11-05',
      'Aino',
      false
    ).reason
  ).toBe('no_coefficient_on_date');
  expect(
    contractSigningState(lists, table, { ...vat, rates: [] }, input, '2026-11-05', 'Aino', false)
      .reason
  ).toBe('no_vat_on_date');
});
