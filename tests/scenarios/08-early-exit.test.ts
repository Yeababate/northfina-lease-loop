import { expect, it } from 'vitest';
import { readExitView } from '@/server/exit-requests';
import { signAino, withScenario } from './fixtures';

// Card 8: Aino ends the card-1 lease (ebike-003, 36 months, band B at 7.9 %) in month 7.
// fair-exit-v2: the 29 remaining rents and the 583.50 € buyout, discounted monthly at 7.9 % a
// year to the exit day (5 Jun 2027), are worth 3 325.25 € instead of the nominal 3 695.20 €.
// Returning the bike credits its market value then: 3 890 € × 80 % (7 months old) × good 0.85
// (assumed until inspected) = 2 645.20 €. VAT on 5 Jun 2027 is 26 %.
it('card 8: Aino sees the month-7 cost of a return and a buyout, step by step', async () => {
  await withScenario(async (db, data) => {
    const contract = await signAino(db, data);
    const view = await readExitView(db, contract.id, 'cust-aino', '2027-05-05');
    const period = {
      effectiveEndOn: '2027-06-05',
      elapsedMonths: 7,
      remainingMonths: 29,
      monthlyRentCents: 10_730,
      method: 'fair-exit-v2',
    };
    const priced = {
      remainingMonths: 29,
      monthlyRentCents: 10_730,
      nominalRemainingRentCents: 311_170,
      endOfTermBuyoutCents: 58_350,
      annualInterestPercent: 7.9,
      discountCents: 36_995,
      buyoutValueCents: 332_525,
      vatRatePercent: 26,
    };
    expect(view.returnQuote).toEqual({
      ok: true,
      quote: expect.objectContaining({
        ...period,
        amountNetCents: 68_005,
        breakdown: {
          ...priced,
          marketValueCents: 264_520,
          valuedItems: [
            {
              assetId: 'ebike-003',
              basis: 'assumed',
              condition: 'good',
              usageUnit: 'km',
              usageValue: 0,
              ageMonths: 7,
              marketValueCents: 264_520,
            },
          ],
          marketValueCreditCents: 264_520,
          netCents: 68_005,
          vatCents: 17_681,
          grossCents: 85_686,
        },
      }),
    });
    expect(view.buyoutQuote).toEqual({
      ok: true,
      quote: expect.objectContaining({
        ...period,
        amountNetCents: 332_525,
        breakdown: {
          ...priced,
          marketValueCents: 0,
          valuedItems: [],
          marketValueCreditCents: 0,
          netCents: 332_525,
          vatCents: 86_457,
          grossCents: 418_982,
        },
      }),
    });
  });
});
