import { expect, it } from 'vitest';
import { secondLifeNote, seedWaitingList } from '@/server/waiting-list';
import { DAY_TWO, withScenario } from './fixtures';

// Card 9 as the customer sees it on ebike-007's page: read-only, from the same decision and
// ranking the provider's match proposal uses, before anyone has inspected the item.
it('card 9: ebike-007’s page says it is refurbished and offered fairly to wait-02 with mandatory work, and why', async () => {
  await withScenario(async (db) => {
    await seedWaitingList(db);
    const note = await secondLifeNote(db, 'ebike-007', DAY_TWO);
    expect(note).toMatchObject({
      fromCondition: 'fair',
      plan: {
        toCondition: 'fair',
        costCents: 39_500,
        work: [
          { id: 'battery_replacement', costCents: 35_000 },
          { id: 'safety_inspection', costCents: 4_500 },
        ],
      },
      winner: { id: 'wait-02', termMonths: 12, monthlyNetCents: 7_397 },
    });
    expect(note?.others).toContainEqual(
      expect.objectContaining({ id: 'wait-13', reason: 'lost:less_refurbishment' })
    );
  });
});

it('shows nothing for an item that is not back from a lease', async () => {
  await withScenario(async (db) => {
    expect(await secondLifeNote(db, 'ebike-003', DAY_TWO)).toBeNull();
  });
});
