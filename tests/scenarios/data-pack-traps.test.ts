import { expect, it } from 'vitest';
import { loadRefurbishmentCosts, loadSecondLifeDemand } from '@/data/load';
import { checkBusinessId } from '@/domain/business-id';
import { priceContract } from '@/domain/contract-pricing';
import { rankWaitingList } from '@/domain/matchmaking';
import { resolveFlow } from '@/domain/question-flow';
import { decideRefurbishment } from '@/domain/refurbish-decision';
import { DAY_ONE, loadScenarioData, signAino, withScenario } from './fixtures';

it('refuses a reserved asset without creating a contract', async () => {
  await withScenario(async (db, data) => {
    await expect(signAino(db, data, 'ebike-009')).rejects.toMatchObject({
      code: 'ASSET_UNAVAILABLE',
    });
    expect(await db.contract.count()).toBe(0);
  });
});

it('preserves finance limits and the exact boundary between laptop price bands', async () => {
  const { lists, table } = await loadScenarioData();
  const quote = (assetId: string) =>
    priceContract(lists, table, { assetId, termMonths: 24, downPaymentCents: 0 }, DAY_ONE);
  expect(quote('ebike-010')).toEqual({ ok: false, reason: 'below_minimum' });
  expect(quote('farm-006')).toEqual({ ok: false, reason: 'above_maximum' });
  expect(quote('laptop-002')).toMatchObject({ price: { financedCents: 199_999, band: 'A' } });
  expect(quote('laptop-003')).toMatchObject({ price: { financedCents: 200_000, band: 'B' } });
});

it('rejects the bad business ID and clears a signatory answer after the applicant can sign', async () => {
  const { customers, questions } = await loadScenarioData();
  const broken = customers.find(({ id }) => id === 'cust-broken-id');
  if (!broken || !('business_id' in broken))
    throw new Error('Expected the broken business fixture');
  expect(checkBusinessId(broken.business_id)).toMatchObject({ ok: false });
  const deal = {
    category: 'e_bike' as const,
    financedAmountCents: 549_000,
    termMonths: 24,
    startDate: DAY_ONE,
  };
  const answers = {
    q_customer_type: 'company',
    q_can_sign: 'no',
    q_signatory_email: 'signer@example.com',
  };
  expect(resolveFlow(questions, deal, answers).answers).toHaveProperty('q_signatory_email');
  const updated = resolveFlow(questions, deal, { ...answers, q_can_sign: 'yes' });
  expect(updated.answers).not.toHaveProperty('q_signatory_email');
  expect(updated.removed).toContain('q_signatory_email');
});

it('uses the earlier sign-up for the two otherwise identical laptop requests', async () => {
  const [{ table }, rules, demand] = await Promise.all([
    loadScenarioData(),
    loadRefurbishmentCosts(),
    loadSecondLifeDemand(),
  ]);
  const entries = demand
    .filter(({ id }) => id === 'wait-06' || id === 'wait-14')
    .reverse()
    .map((entry) => ({ ...entry, status: 'waiting' as const }));
  const decision = decideRefurbishment(
    {
      category: 'laptop',
      condition: 'good',
      usageUnit: 'battery_cycles',
      usageValue: 0,
      hoursSinceService: null,
    },
    { ...rules, laptop: { ...rules.laptop, fixed: [] } },
    () => 60_000
  );
  const { ranked } = rankWaitingList(
    { category: 'laptop', readyOn: DAY_ONE },
    decision.options,
    entries,
    DAY_ONE,
    table,
    25.5
  );
  expect(ranked.map(({ entry }) => entry.id)).toEqual(['wait-06', 'wait-14']);
  expect(ranked[0]?.rankReason).toBe('earlier_sign_up');
});
