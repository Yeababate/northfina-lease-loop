import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().nonnegative();
const kind = z.enum(['return', 'buyout']);

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
