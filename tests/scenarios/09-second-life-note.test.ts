import { expect, it } from 'vitest';
import { secondLifeNote, seedWaitingList } from '@/server/waiting-list';
import { DAY_TWO, withScenario } from './fixtures';

// Card 9 as the customer sees it on ebike-007's page: read-only, from the same decision and
// ranking the provider's match proposal uses, before anyone has inspected the item.
it('card 9: ebike-007’s page says it is refurbished and offered to wait-13 first, and why', async () => {
  await withScenario(async (db) => {
    await seedWaitingList(db);
    const note = await secondLifeNote(db, 'ebike-007', DAY_TWO);
    expect(note).toMatchObject({
      fromCondition: 'fair',
      plan: {
        toCondition: 'good',
        costCents: 51_500,
        work: [
          { id: 'battery_replacement', costCents: 35_000 },
          { id: 'safety_inspection', costCents: 4_500 },
          { id: 'upgrade:fair->good', costCents: 12_000 },
        ],
      },
      winner: { id: 'wait-13', termMonths: 24, monthlyNetCents: 6_326 },
    });
    expect(note?.others).toContainEqual(
      expect.objectContaining({ id: 'wait-02', reason: 'over_budget' })
    );
  });
});

it('shows nothing for an item that is not back from a lease', async () => {
  await withScenario(async (db) => {
    expect(await secondLifeNote(db, 'ebike-003', DAY_TWO)).toBeNull();
  });
});
