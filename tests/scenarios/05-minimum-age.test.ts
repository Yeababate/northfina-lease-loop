import { expect, it } from 'vitest';
import { decideApplication } from '@/domain/eligibility';
import { resolveFlow } from '@/domain/question-flow';
import { getT } from '@/i18n/get-t';
import { signApplication } from '@/server/contracts';
import { DAY_ONE, previewScenario, withScenario } from './fixtures';

it('card 5: Mikko is declined on age with a clear reason and no signed lease', async () => {
  await withScenario(async (db, data) => {
    const mikko = data.customers.find(({ id }) => id === 'cust-mikko');
    if (mikko?.type !== 'consumer') throw new Error('Expected Mikko’s consumer fixture');
    const answers = {
      q_customer_type: 'consumer',
      q_full_name: mikko.name,
      q_birth_date: mikko.birth_date,
    };
    const { price, expected } = await previewScenario(
      db,
      data,
      { assetId: 'laptop-008', termMonths: 24, downPaymentCents: 0, startOn: DAY_ONE },
      DAY_ONE
    );
    const deal = {
      category: 'laptop' as const,
      termMonths: 24,
      startDate: DAY_ONE,
      financedAmountCents: price.financedCents,
    };
    expect(
      decideApplication({
        flow: resolveFlow(data.questions, deal, answers),
        deal,
        coefficientTable: data.table,
        monthlyRentWithVatCents: 0,
      })
    ).toMatchObject({ outcome: 'declined', reasons: [{ rule: 'min_age', result: 'failed' }] });
    expect(getT('en')('reason.min_age')).toContain('welcome to come back');
    await expect(
      signApplication(db, { ...expected, answers }, DAY_ONE, data)
    ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    expect(await db.contract.count()).toBe(0);
  });
});
