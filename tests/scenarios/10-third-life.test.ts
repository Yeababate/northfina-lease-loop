import { expect, it } from 'vitest';
import { recordInspection, recordWork, relist } from '@/server/next-life-commands';
import { loadPassport } from '@/server/passport';
import { DAY_ONE, signAino, withScenario } from './fixtures';

it('card 10: relists and signs the third life with two seed lives and a carbon estimate', async () => {
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
    await signAino(db, data, 'ebike-008', DAY_ONE, 24);
    expect(await loadPassport(db, 'ebike-008')).toMatchObject({
      earlierLives: 2,
      lives: [
        {
          number: 3,
          ending: 'active',
          priceSource: 'next_life',
          estimatedCo2SavingGrams: expect.any(Number),
        },
      ],
      totals: { lives: 3, estimatedLives: 1, estimatedCo2SavingGrams: expect.any(Number) },
    });
  });
});
