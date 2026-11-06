import { expect, it } from 'vitest';
import { readExitView } from '@/server/exit-requests';
import { signAino, withScenario } from './fixtures';

it('card 8: Aino sees the month-7 fee and the inputs used by the existing exit policy', async () => {
  await withScenario(async (db, data) => {
    const contract = await signAino(db, data);
    const view = await readExitView(db, contract.id, 'cust-aino', '2027-05-05');
    expect(view.returnQuote).toMatchObject({
      ok: true,
      quote: {
        elapsedMonths: 7,
        remainingMonths: 29,
        monthlyRentCents: 10_730,
        amountNetCents: 155_585,
        method: 'half-remaining-rent-v1',
      },
    });
  });
});

it.todo('explains discounted rents and the market-value credit under the v2 exit policy (#43)');
