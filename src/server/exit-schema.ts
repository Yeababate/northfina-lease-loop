import { z } from 'zod';
import { assetConditionSchema, isoDateSchema, usageUnitSchema } from '@/data/schemas';

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().nonnegative();
const kind = z.enum(['return', 'buyout']);

const percent = z.number().min(0).max(100);
const months = z.number().int().min(0).max(1200);

/** The fair-exit-v2 breakdown the client echoes back; compared field by field on request. */
const breakdownSchema = z.strictObject({
  remainingMonths: months,
  monthlyRentCents: cents,
  nominalRemainingRentCents: cents,
  endOfTermBuyoutCents: cents,
  annualInterestPercent: percent,
  discountCents: cents,
  buyoutValueCents: cents,
  marketValueCents: cents,
  valuedItems: z
    .array(
      z.strictObject({
        assetId: z.string().min(1),
        basis: z.enum(['inspected', 'assumed']),
        condition: assetConditionSchema,
        usageUnit: usageUnitSchema,
        usageValue: z.number().int().nonnegative(),
        ageMonths: months,
        marketValueCents: cents,
      })
    )
    .max(100),
  marketValueCreditCents: cents,
  netCents: cents,
  vatRatePercent: percent,
  vatCents: cents,
  grossCents: cents,
});

export const exitQuoteSchema = z.strictObject({
  contractId: z.string().min(1),
  kind,
  effectiveEndOn: isoDateSchema,
  periodStartOn: isoDateSchema,
  elapsedMonths: z.number().int().min(0).max(1200),
  remainingMonths: z.number().int().min(0).max(1200),
  monthlyRentCents: cents,
  amountNetCents: cents,
  method: z.string().min(1).max(100),
  contractRevision: revision,
  breakdown: breakdownSchema.optional(),
});

export const exitCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('request'),
    requestId: z.uuid(),
    kind,
    expectedQuote: exitQuoteSchema,
  }),
  z.strictObject({ action: z.literal('withdraw'), exitId: z.uuid(), expectedRevision: revision }),
  z.strictObject({
    action: z.literal('receive'),
    exitId: z.uuid(),
    expectedRevision: revision,
    assetIds: z.array(z.string().min(1)).min(1).max(100),
    balancesReviewed: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('paid'),
    exitId: z.uuid(),
    expectedRevision: revision,
    balancesReviewed: z.boolean(),
  }),
]);
