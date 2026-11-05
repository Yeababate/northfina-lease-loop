import { expect, it } from 'vitest';
import { planLegacyContractStart, type LegacyStartEvidence } from './legacy-contract-start';

const legacy: LegacyStartEvidence = {
  signedOn: '2026-01-31',
  endOn: '2029-01-31',
  termMonths: 36,
  provenance: 'original-signing-day-policy',
  invoices: [
    { period: 1, invoiceDate: '2026-01-31' },
    { period: 26, invoiceDate: '2028-02-29' },
  ],
};

it('plans the original signing-day policy without repricing or mutating evidence', () => {
  const before = structuredClone(legacy);
  expect(planLegacyContractStart(legacy)).toEqual({
    ok: true,
    startOn: '2026-01-31',
    source: 'legacy_signing_policy',
  });
  expect(legacy).toEqual(before);
});
it('does not infer a start solely from compatible dates without verified provenance', () => {
  expect(planLegacyContractStart({ ...legacy, provenance: 'unknown' })).toEqual({
    ok: false,
    reason: 'unknown_start',
  });
});
it('preserves a known future start instead of replacing it with the signing date', () => {
  expect(
    planLegacyContractStart({
      ...legacy,
      startOn: '2026-02-28',
      endOn: '2029-02-28',
      provenance: 'unknown',
      invoices: [],
    })
  ).toMatchObject({ ok: true, startOn: '2026-02-28', source: 'stored' });
});
it('stops on contradictory end dates or invoice evidence', () => {
  expect(planLegacyContractStart({ ...legacy, endOn: '2029-02-28' })).toMatchObject({
    ok: false,
    reason: 'inconsistent_end',
  });
  for (const invoices of [
    [{ period: 1, invoiceDate: '2026-02-01' }],
    [{ period: 37, invoiceDate: '2029-01-31' }],
    [
      { period: 1, invoiceDate: '2026-01-31' },
      { period: 1, invoiceDate: '2026-01-31' },
    ],
  ])
    expect(planLegacyContractStart({ ...legacy, invoices })).toMatchObject({
      ok: false,
      reason: 'inconsistent_invoices',
    });
});
it('rejects invalid dates, terms and a start before signing', () => {
  for (const patch of [
    { signedOn: '2026-02-30' },
    { endOn: 'bad' },
    { termMonths: 0 },
    { termMonths: 49 },
    { termMonths: 1.5 },
    { startOn: '2026-01-30' },
    { startOn: 'bad' },
  ])
    expect(planLegacyContractStart({ ...legacy, ...patch })).toMatchObject({
      ok: false,
      reason: 'invalid_contract',
    });
});
