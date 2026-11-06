import { expect, it } from 'vitest';
import { recordInspection } from '@/server/next-life-commands';
import { getWaitingListMatches, seedWaitingList } from '@/server/waiting-list';
import { DAY_ONE, withScenario } from './fixtures';

it('card 9: prices the work and selects the courier whose term and budget fit', async () => {
  await withScenario(async (db) => {
    await seedWaitingList(db);
    const intakeId = 'seed-ebike-007';
    const providerId = 'provider-kettu';
    await recordInspection(
      db,
      providerId,
      intakeId,
      { expectedRevision: 0, condition: 'fair', usageValue: 18_400, hoursSinceService: null },
      DAY_ONE
    );
    const match = await getWaitingListMatches(db, providerId, intakeId, DAY_ONE);
    expect(match.ranked[0]).toMatchObject({
      entry: { id: 'wait-02' },
      monthlyNetCents: 7_397,
      option: {
        id: 'as_is',
        costCents: 39_500,
        work: expect.arrayContaining([
          { action: expect.objectContaining({ id: 'battery_replacement' }), costCents: 35_000 },
        ]),
      },
    });
    expect(match.ranked[1]).toMatchObject({
      entry: { id: 'wait-13' },
      rankReason: 'less_refurbishment',
    });
  });
});
