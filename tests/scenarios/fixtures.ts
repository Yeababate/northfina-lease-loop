import {
  loadAssets,
  loadCoefficientTable,
  loadCustomers,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { priceContract, type PricingInput } from '@/domain/contract-pricing';
import { assetPriceOverride, seedAssets } from '@/server/assets';
import { signApplication, type SigningData } from '@/server/contracts';
import { seedDemoParticipants } from '@/server/demo-participants';
import type { PrismaClient } from '@/server/prisma-client';
import { seedDealerSide } from '@/server/providers';
import { createTestDb } from '../helpers/test-db';

export const DAY_ONE = '2026-11-05';
export const DAY_TWO = '2026-11-06';
export const aino = {
  q_customer_type: 'consumer',
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1992-03-14',
  q_email: 'aino@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320_000,
  q_usage_purpose: 'commuting',
};

export async function loadScenarioData() {
  const [assets, customers, lists, table, vatRates, questions] = await Promise.all([
    loadAssets(),
    loadCustomers(),
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  return { assets, customers, lists, table, vatRates, questions: questions.questions };
}

export async function withScenario(
  run: (db: PrismaClient, data: Awaited<ReturnType<typeof loadScenarioData>>) => Promise<void>
) {
  const { db, cleanup } = await createTestDb();
  try {
    const data = await loadScenarioData();
    await seedAssets(db, data.assets);
    await seedDealerSide(db, data.assets);
    await seedDemoParticipants(db);
    await run(db, data);
  } finally {
    await cleanup();
  }
}

export async function previewScenario(
  db: PrismaClient,
  data: SigningData,
  input: PricingInput & { startOn: string },
  signedOn: string
) {
  const row = await db.asset.findUniqueOrThrow({ where: { id: input.assetId } });
  const result = priceContract(
    data.lists,
    data.table,
    input,
    signedOn,
    [],
    assetPriceOverride(row)
  );
  if (!result.ok)
    throw new Error(`Scenario ${input.assetId} could not be priced: ${result.reason}`);
  return {
    price: result.price,
    expected: {
      ...input,
      expectedMonthlyNetCents: result.price.monthlyNetCents,
      expectedBuyoutNetCents: result.price.buyoutNetCents,
      expectedPriceListVersion: result.price.priceListVersion,
      expectedPriceSource: result.price.priceSource,
      expectedListPriceCents: result.price.listPriceCents,
    },
  };
}

export async function signAino(
  db: PrismaClient,
  data: SigningData,
  assetId = 'ebike-003',
  signedOn = DAY_ONE,
  termMonths = 36,
  startOn = signedOn
) {
  const { expected } = await previewScenario(
    db,
    data,
    { assetId, termMonths, downPaymentCents: 0, startOn },
    signedOn
  );
  return signApplication(db, { ...expected, answers: aino }, signedOn, data, 'cust-aino');
}
