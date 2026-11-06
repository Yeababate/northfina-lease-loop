// #52 "Done when": catalogue badges for Aino, Mikko and a PEP across the whole catalogue,
// on a migrated database with the data pack's assets.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadPriceLists, loadQuestions } from '@/data/load';
import type { Question } from '@/data/schemas';
import type { AnswerValue } from '@/domain/answer-check';
import { parseProfileKey } from '@/domain/answer-scope';
import { listPriceOn } from '@/domain/price-list';
import { createTestDb } from '../../tests/helpers/test-db';
import { assetPriceOverride, seedAssets } from './assets';
import { catalogueReadiness, rememberedSetsFor } from './catalogue-readiness';
import { ensureDemoUser } from './mock-users';
import type { PrismaClient } from './prisma-client';
import { saveAnswer } from './saved-answers';

// The last day of price list 1, as in the other readiness tests.
const TODAY = '2026-11-05';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let questions: Question[];
let assetIds: string[];
let category: Map<string, string>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const assets = await loadAssets();
  await seedAssets(db, assets);
  ({ questions } = await loadQuestions());
  assetIds = assets.map((asset) => asset.id);
  category = new Map(assets.map((asset) => [asset.id, asset.category]));
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.savedAnswer.deleteMany();
});

const AINO: Record<string, AnswerValue> = {
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1997-04-12',
  q_email: 'aino.virtanen@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320000,
  q_pep: 'no',
};

async function userWith(name: string, answers: Record<string, AnswerValue>) {
  const user = await ensureDemoUser(db, name);
  const profileKey = parseProfileKey('consumer');
  if (!profileKey) throw new Error('consumer key');
  for (const [questionId, value] of Object.entries(answers)) {
    await saveAnswer(
      db,
      { userId: user.id, profileKey, questionId, value, today: TODAY },
      questions
    );
  }
  return user.id;
}

async function badges(userId: string) {
  const result = await catalogueReadiness(db, userId, assetIds, 36, TODAY);
  return [...result.byAssetId.values()].filter((item) => item.status !== 'not_leasable');
}

describe('catalogue readiness (#52 done when)', () => {
  it('Aino: ready on e-bikes and laptops, questions to go on farm machines', async () => {
    const items = await badges(await userWith('Aino', AINO));
    const of = (cat: string) => items.filter((item) => category.get(item.assetId) === cat);

    expect(of('e_bike').length).toBeGreaterThan(0);
    for (const item of [...of('e_bike'), ...of('laptop')]) {
      expect(item.status, item.assetId).toBe('ready');
    }
    // Every farm machine still needs the farm registry. Those whose 36-month rent fits her
    // income show "questions to go"; the dearer ones are declined on affordability only,
    // which a longer term or a down payment can change (the item page follows the slider).
    const farm = of('farm_machine');
    expect(farm.filter((item) => item.status === 'missing').length).toBeGreaterThan(0);
    for (const item of farm) {
      expect(['missing', 'declined'], item.assetId).toContain(item.status);
      if (item.status === 'missing' || item.status === 'declined') {
        expect(item.missing.questionIds).toEqual(['q_farm_registry']);
      }
      if (item.status === 'declined') expect(item.reasons).toEqual(['affordability']);
    }
  });

  it('Mikko (17): kindly not available on every item he could otherwise lease', async () => {
    const items = await badges(
      await userWith('Mikko', { ...AINO, q_birth_date: '2009-03-10', q_monthly_income: 40000 })
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.status, item.assetId).toBe('declined');
      if (item.status === 'declined') expect(item.reasons).toContain('min_age');
    }
  });

  it('a PEP: a person checks only the leases from €10,000', async () => {
    const userId = await userWith('Pia', {
      ...AINO,
      q_monthly_income: 5000000,
      q_pep: 'yes',
      q_pep_details: 'City council',
    });
    const result = await catalogueReadiness(db, userId, assetIds, 36, TODAY);
    const lists = await loadPriceLists();
    let reviewed = 0;
    for (const id of assetIds) {
      const item = result.byAssetId.get(id);
      if (!item || item.status === 'not_leasable' || item.status === 'not_found') continue;
      const row = await db.asset.findUnique({ where: { id } });
      const price = listPriceOn(lists, id, TODAY, row ? assetPriceOverride(row) : undefined);
      if (!price.ok) throw new Error(`no price for ${id}`);
      // No down payment, so the financed amount is the list price.
      const fromTenThousand = price.priceCents >= 1000000;
      expect(item.status === 'manual_review', id).toBe(fromTenThousand);
      if (item.status === 'manual_review') {
        reviewed += 1;
        expect(item.reasons).toEqual(['pep_manual_review']);
      }
    }
    expect(reviewed).toBeGreaterThan(0);
  });

  it('gives no profile key before anything is saved, and lists remembered sets', async () => {
    const user = await ensureDemoUser(db, 'Nobody');
    expect((await catalogueReadiness(db, user.id, assetIds, 36, TODAY)).profileKey).toBeNull();
    expect((await catalogueReadiness(db, user.id, [], 36, TODAY)).byAssetId.size).toBe(0);
    expect(await rememberedSetsFor(db, null, questions, TODAY)).toBeNull();
    expect(await rememberedSetsFor(db, user.id, questions, TODAY)).toEqual([]);

    const aino = await userWith('Aino', { q_pep: 'yes', q_pep_details: 'Mayor' });
    expect(await rememberedSetsFor(db, aino, questions, TODAY)).toEqual([
      {
        profileKey: 'consumer',
        answers: { q_pep: 'yes', q_pep_details: 'Mayor' },
        flags: [expect.objectContaining({ id: 'pep_yes', minFinancedCents: 1000000 })],
      },
    ]);
  });
});
