import { expect, it } from 'vitest';
import { priceLockNote } from '@/domain/application-signing';
import { signApplication } from '@/server/contracts';
import { aino, DAY_ONE, DAY_TWO, previewScenario, withScenario } from './fixtures';

it('card 2: rejects the stale laptop quote and locks the lower list at signing', async () => {
  await withScenario(async (db, data) => {
    const input = { assetId: 'laptop-004', termMonths: 36, downPaymentCents: 0, startOn: DAY_TWO };
    const quoted = await previewScenario(db, data, input, DAY_ONE);
    const revised = await previewScenario(db, data, input, DAY_TWO);
    expect(quoted.price).toMatchObject({ priceListVersion: 1, listPriceCents: 349_000 });
    expect(priceLockNote(quoted.price, revised.price)).toMatchObject({
      listChanged: true,
      direction: 'lower',
    });
    await expect(
      signApplication(db, { ...quoted.expected, answers: aino }, DAY_TWO, data, 'cust-aino')
    ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(
      await signApplication(db, { ...revised.expected, answers: aino }, DAY_TWO, data, 'cust-aino')
    ).toMatchObject({ priceListVersion: 2, listPriceCents: 321_100 });
  });
});

it.todo('persists the original quote version beside the signed version (#45)');
