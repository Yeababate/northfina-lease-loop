import { expect, it } from 'vitest';
import { signApplication } from '@/server/contracts';
import { loadImpactInputs } from '@/server/impact';
import { loadMyLeases } from '@/server/my-leases';
import { recordInspection, recordWork, relist } from '@/server/next-life-commands';
import { loadPassport } from '@/server/passport';
import { signAsSignatory, signatoryOffer } from '@/server/signatory';
import { DAY_ONE, DAY_TWO, previewScenario, withScenario } from './fixtures';

// Issue #79: a company application that still waits for its authorised signatory (Card 6)
// is not a life yet. The third life of ebike-008 (Card 10) appears only once it is signed.
const company = {
  q_customer_type: 'company',
  q_email: 'fleet@norvi.example.com',
  q_business_id: '3299871-7',
  q_company_name: 'Norvi Logistics Oy',
  q_can_sign: 'no',
  q_signatory_email: 'signatory@norvi.example.com',
  q_vat_registered: 'yes',
  q_usage_purpose: 'delivery',
  q_pep: 'no',
};

it('card 10: an unsigned company application is not an active third life or impact', async () => {
  await withScenario(async (db, data) => {
    const intakeId = 'seed-ebike-008';
    const providerId = 'provider-kettu';
    await recordInspection(
      db,
      providerId,
      intakeId,
      { expectedRevision: 0, condition: 'good', usageValue: 9800, hoursSinceService: null },
      DAY_ONE
    );
    await recordWork(
      db,
      providerId,
      intakeId,
      { expectedRevision: 1, actionId: 'safety_inspection' },
      DAY_ONE
    );
    await relist(db, providerId, intakeId, { expectedRevision: 2 }, DAY_ONE);
    const { expected } = await previewScenario(
      db,
      data,
      { assetId: 'ebike-008', termMonths: 24, downPaymentCents: 0, startOn: DAY_ONE },
      DAY_ONE
    );
    const sent = await signApplication(
      db,
      { ...expected, answers: company },
      DAY_ONE,
      data,
      'cust-norvi'
    );
    const inputs = await loadImpactInputs();

    const waiting = {
      earlierLives: 2,
      lives: [],
      totals: { lives: 2, estimatedLives: 0, estimatedCo2SavingGrams: null },
    };
    // Repeated reads stay the same while the signatory has not signed.
    expect(await loadPassport(db, 'ebike-008')).toMatchObject(waiting);
    expect(await loadPassport(db, 'ebike-008')).toMatchObject(waiting);
    const pendingLeases = await loadMyLeases(db, 'cust-norvi', DAY_ONE, data.vatRates, inputs);
    expect(pendingLeases.current[0]).toMatchObject({
      awaitingSignatory: 'signatory@norvi.example.com',
    });
    expect(pendingLeases.impact).toBeNull();

    const signatory = await db.demoUser.create({
      data: {
        id: 'norvi-signatory',
        canonicalUsername: 'signatory@norvi.example.com',
        displayName: 'signatory@norvi.example.com',
      },
    });
    // The applied start day has passed, so the signatory signs from today.
    const offer = await signatoryOffer(db, signatory, sent.id, DAY_TWO, data, DAY_TWO);
    if (!offer.ok) throw new Error(`Expected a current signatory offer: ${offer.reason}`);
    await signAsSignatory(db, signatory, sent.id, DAY_TWO, data, offer.snapshot);

    const signed = {
      earlierLives: 2,
      lives: [
        {
          number: 3,
          startOn: DAY_TWO,
          ending: 'active',
          priceSource: 'next_life',
          // The reading at signature: the safety inspection does not reset the counter.
          start: { condition: 'good', usage: { value: 9800 } },
          estimatedCo2SavingGrams: expect.any(Number),
        },
      ],
      totals: { lives: 3, estimatedLives: 1, estimatedCo2SavingGrams: expect.any(Number) },
    };
    expect(await loadPassport(db, 'ebike-008')).toMatchObject(signed);
    expect(await loadPassport(db, 'ebike-008')).toMatchObject(signed);
    const leases = await loadMyLeases(db, 'cust-norvi', DAY_TWO, data.vatRates, inputs);
    expect(leases.impact).toMatchObject({ estimatedCount: 1, unavailableCount: 0 });
  });
});
