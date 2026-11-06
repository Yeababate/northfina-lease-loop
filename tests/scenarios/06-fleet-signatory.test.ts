import { expect, it } from 'vitest';
import { signApplication } from '@/server/contracts';
import { generateInvoices } from '@/server/invoices';
import { signAsSignatory } from '@/server/signatory';
import { signatoryOffer } from '@/server/signatory';
import { DAY_ONE, previewScenario, withScenario } from './fixtures';

// As corrected by the organisers: Norvi applies for 1 × ebike-004. The applicant answers
// "no" to "Can you sign contracts for the company?", gives the signatory's email, and the
// contract waits, not signed and not active, until that person signs.
const norvi = {
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

it('card 6: Norvi’s contract waits for the authorised signatory, then becomes active', async () => {
  await withScenario(async (db, data) => {
    const { expected } = await previewScenario(
      db,
      data,
      { assetId: 'ebike-004', termMonths: 36, downPaymentCents: 0, startOn: DAY_ONE },
      DAY_ONE
    );
    const sent = await signApplication(
      db,
      { ...expected, answers: norvi },
      DAY_ONE,
      data,
      'cust-norvi'
    );
    expect(sent).toMatchObject({
      actor: 'Norvi Logistics Oy',
      signatoryEmail: 'signatory@norvi.example.com',
      signatorySignedOn: null,
    });
    expect(await db.contractLifecycle.findUnique({ where: { contractId: sent.id } })).toMatchObject(
      { status: 'awaiting_signature' }
    );
    // Nothing is billed before the signatory signs.
    await expect(generateInvoices(db, sent.id, 'cust-norvi', data.vatRates)).rejects.toMatchObject({
      code: 'AWAITING_SIGNATURE',
    });

    const signatory = await db.demoUser.create({
      data: {
        id: 'norvi-signatory',
        canonicalUsername: 'signatory@norvi.example.com',
        displayName: 'signatory@norvi.example.com',
      },
    });
    const offer = await signatoryOffer(db, signatory, sent.id, DAY_ONE, data);
    if (!offer.ok) throw new Error('Expected a current signatory offer');
    const signed = await signAsSignatory(db, signatory, sent.id, DAY_ONE, data, offer.snapshot);
    expect(signed).toMatchObject({ signatorySignedOn: DAY_ONE, lifecycle: { status: 'active' } });
    expect(await generateInvoices(db, sent.id, 'cust-norvi', data.vatRates)).toHaveLength(36);
  });
});
