import { randomUUID } from 'node:crypto';
import type { Quote } from '@/generated/prisma/client';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import { vatCents } from '@/domain/vat';
import { vatRateOn } from '@/domain/vat';
import { priceContract, type PricingInput } from '@/domain/contract-pricing';
import type { PriceSource } from '@/domain/price-list';
import { isLeasable } from '@/domain/catalogue';
import { ApiError } from './api-response';
import { assetPriceOverride, toAsset } from './assets';
import { withAudit } from './audit';
import { rulesForAsset } from './discount-rules';
import type { PrismaClient } from './prisma-client';

export type QuoteOfferExpectation = {
  monthlyNetCents: number;
  originalMonthlyNetCents: number;
  monthlyDiscountCents: number;
  discountBps: number;
  buyoutNetCents: number;
  monthlyGrossCents: number;
  priceListVersion: number;
  priceSource: PriceSource;
  listPriceCents: number;
  discountRuleId: string | null;
  discountRuleRevision: number | null;
  coefficientVersion: number;
  coefficientId: string;
  band: string;
  factor: number;
};

export type CreateQuoteInput = Omit<PricingInput, 'startOn'> & {
  startOn: string;
  requestKey: string;
  quotedOn: string;
  expected: QuoteOfferExpectation;
};

export type QuotePricingData = {
  lists: readonly PriceList[];
  table: CoefficientTable;
  vatRates: VatRates;
};

function matchesExpected(
  price: NonNullable<Extract<ReturnType<typeof priceContract>, { ok: true }>['price']>,
  gross: number,
  expected: QuoteOfferExpectation
) {
  return (
    price.monthlyNetCents === expected.monthlyNetCents &&
    price.originalMonthlyNetCents === expected.originalMonthlyNetCents &&
    price.monthlyDiscountCents === expected.monthlyDiscountCents &&
    price.discountBps === expected.discountBps &&
    price.buyoutNetCents === expected.buyoutNetCents &&
    gross === expected.monthlyGrossCents &&
    price.priceListVersion === expected.priceListVersion &&
    price.priceSource === expected.priceSource &&
    price.listPriceCents === expected.listPriceCents &&
    price.discountRuleId === expected.discountRuleId &&
    price.discountRuleRevision === expected.discountRuleRevision &&
    price.coefficientVersion === expected.coefficientVersion &&
    price.coefficientId === expected.coefficientId &&
    price.band === expected.band &&
    price.factor === expected.factor
  );
}

function snapshotInputMatches(
  quote: {
    renterId: string;
    assetId: string;
    termMonths: number;
    downPaymentCents: number;
    startOn: string;
  },
  renterId: string,
  input: CreateQuoteInput
) {
  return (
    quote.renterId === renterId &&
    quote.assetId === input.assetId &&
    quote.termMonths === input.termMonths &&
    quote.downPaymentCents === input.downPaymentCents &&
    quote.startOn === input.startOn
  );
}

/** Saves the exact server-recomputed offer, with an idempotency key for navigation retries. */
export async function createQuote(
  db: PrismaClient,
  renterId: string,
  input: CreateQuoteInput,
  today: string,
  data: QuotePricingData
) {
  const existing = await db.quote.findUnique({ where: { requestKey: input.requestKey } });
  if (existing) {
    if (!snapshotInputMatches(existing, renterId, input))
      throw new ApiError(409, 'QUOTE_MISMATCH', 'This quote request was already used');
    return { quote: existing, created: false } as const;
  }
  if (input.quotedOn !== today)
    throw new ApiError(
      409,
      'PRICE_CHANGED',
      'Refresh the item price before starting an application'
    );

  const asset = await db.asset.findUnique({ where: { id: input.assetId } });
  if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  if (asset.status !== 'available' || !isLeasable(toAsset(asset)))
    throw new ApiError(409, 'ASSET_UNAVAILABLE', 'This item is unavailable');
  const discountRules = await rulesForAsset(db, input.assetId);
  const priced = priceContract(
    data.lists,
    data.table,
    input,
    input.quotedOn,
    discountRules,
    assetPriceOverride(asset)
  );
  if (!priced.ok) throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced');
  const vat = vatRateOn(data.vatRates.rates, input.startOn);
  if (!vat.ok) throw new ApiError(422, 'INVALID_PRICE', 'VAT is unavailable for this lease');
  const gross =
    priced.price.monthlyNetCents + vatCents(priced.price.monthlyNetCents, vat.rate.rate_percent);
  if (!matchesExpected(priced.price, gross, input.expected))
    throw new ApiError(409, 'PRICE_CHANGED', 'Refresh and review the changed offer');

  const id = randomUUID();
  let quote: Quote;
  try {
    quote = await withAudit(
      db,
      {
        actor: renterId,
        action: 'quote.created',
        entityType: 'quote',
        entityId: id,
        details: {
          quotedOn: input.quotedOn,
          ...priced.price,
          vatPercent: vat.rate.rate_percent,
          monthlyGrossCents: gross,
        },
      },
      async (tx) => {
        // Recheck offer inputs under the audited write transaction so rule/asset changes
        // between the initial read and persistence cannot create a mismatched snapshot.
        const currentAsset = await tx.asset.findUnique({ where: { id: input.assetId } });
        if (!currentAsset || currentAsset.status !== 'available')
          throw new ApiError(409, 'ASSET_UNAVAILABLE', 'This item is unavailable');
        const current = priceContract(
          data.lists,
          data.table,
          input,
          input.quotedOn,
          await rulesForAsset(tx, input.assetId),
          assetPriceOverride(currentAsset)
        );
        const currentVat = vatRateOn(data.vatRates.rates, input.startOn);
        if (!current.ok || !currentVat.ok)
          throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced');
        const currentGross =
          current.price.monthlyNetCents +
          vatCents(current.price.monthlyNetCents, currentVat.rate.rate_percent);
        if (!matchesExpected(current.price, currentGross, input.expected))
          throw new ApiError(409, 'PRICE_CHANGED', 'Refresh and review the changed offer');
        return tx.quote.create({
          data: {
            id,
            requestKey: input.requestKey,
            renterId,
            assetId: input.assetId,
            termMonths: input.termMonths,
            downPaymentCents: input.downPaymentCents,
            startOn: input.startOn ?? input.quotedOn,
            quotedOn: input.quotedOn,
            priceSource: current.price.priceSource,
            priceListVersion: current.price.priceListVersion,
            coefficientVersion: current.price.coefficientVersion,
            coefficientId: current.price.coefficientId,
            band: current.price.band,
            factor: current.price.factor,
            listPriceCents: current.price.listPriceCents,
            financedCents: current.price.financedCents,
            monthlyNetCents: current.price.monthlyNetCents,
            originalMonthlyNetCents: current.price.originalMonthlyNetCents,
            monthlyDiscountCents: current.price.monthlyDiscountCents,
            discountBps: current.price.discountBps,
            discountRuleId: current.price.discountRuleId,
            discountRuleRevision: current.price.discountRuleRevision,
            buyoutNetCents: current.price.buyoutNetCents,
            vatPercent: currentVat.rate.rate_percent,
            monthlyGrossCents: currentGross,
          },
        });
      }
    );
  } catch (error) {
    // If two browser retries arrive together, the winner's unique request key is the quote.
    const raced = await db.quote.findUnique({ where: { requestKey: input.requestKey } });
    if (raced && snapshotInputMatches(raced, renterId, input))
      return { quote: raced, created: false } as const;
    throw error;
  }
  return { quote, created: true } as const;
}
