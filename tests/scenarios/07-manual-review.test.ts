import { expect, it } from 'vitest';
import { decideApplication } from '@/domain/eligibility';
import { resolveFlow } from '@/domain/question-flow';
import { signApplication } from '@/server/contracts';
import { DAY_ONE, previewScenario, withScenario } from './fixtures';

it('card 7: Haapalan Tila sees the high-value farm questions and needs manual review', async () => {
  await withScenario(async (db, data) => {
    const farm = data.customers.find(({ id }) => id === 'cust-haapala');
    if (farm?.type !== 'company') throw new Error('Expected Haapalan Tila’s company fixture');
    const yesNo = (value: boolean) => (value ? 'yes' : 'no');
    const answers = {
      q_customer_type: 'company',
      q_email: farm.email,
      q_business_id: farm.business_id,
      q_company_name: farm.name,
      q_can_sign: yesNo(farm.applicant_can_sign),
      q_vat_registered: yesNo(farm.vat_registered),
      q_farm_registry: '123456789',
      q_annual_revenue: farm.annual_revenue_cents,
      q_beneficial_owners: farm.beneficial_owners ?? [],
      q_pep: yesNo(farm.is_pep),
      q_pep_details: 'Position and date given by applicant',
    };
    const { price, expected } = await previewScenario(
      db,
      data,
      { assetId: 'farm-002', termMonths: 48, downPaymentCents: 2_000_000, startOn: DAY_ONE },
      DAY_ONE
    );
    expect(price).toMatchObject({ listPriceCents: 14_500_000, financedCents: 12_500_000 });
    const deal = {
      category: 'farm_machine' as const,
      termMonths: 48,
      startDate: DAY_ONE,
      financedAmountCents: price.financedCents,
    };
    const flow = resolveFlow(data.questions, deal, answers);
    expect(flow.answered).toEqual(
      expect.arrayContaining([
        'q_farm_registry',
        'q_annual_revenue',
        'q_beneficial_owners',
        'q_pep',
        'q_pep_details',
      ])
    );
    expect(
      decideApplication({ flow, deal, coefficientTable: data.table, monthlyRentWithVatCents: 0 })
    ).toMatchObject({
      outcome: 'manual_review',
      reasons: [{ rule: 'pep_manual_review', result: 'review' }],
    });
    await expect(
      signApplication(db, { ...expected, answers }, DAY_ONE, data)
    ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    expect(await db.contract.count()).toBe(0);
  });
});
