import { randomUUID } from 'node:crypto';
import type { CoefficientTable, PriceList, Question, VatRates } from '@/data/schemas';
import type { Answers } from '@/domain/answer-check';
import { checkApplicationForSigning } from '@/domain/application-signing';
import { priceContract, type PricingInput } from '@/domain/contract-pricing';
import { vatCents, vatRateOn } from '@/domain/vat';
import { ApiError } from './api-response';
import { getAsset } from './assets';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

/** No update operation is exposed: signing creates an immutable price snapshot. */
export async function signContract(
  db: PrismaClient,
  input: PricingInput & {
    actor: string;
    expectedMonthlyNetCents: number;
    expectedPriceListVersion: number;
  },
  signedOn: string,
  lists: readonly PriceList[],
  table: CoefficientTable
) {
  const result = priceContract(
    lists,
    table,
    {
      assetId: input.assetId,
      termMonths: input.termMonths,
      downPaymentCents: input.downPaymentCents,
      startOn: input.startOn,
    },
    signedOn
  );
  if (!result.ok)
    throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced', result.reason);
  if (
    result.price.monthlyNetCents !== input.expectedMonthlyNetCents ||
    result.price.priceListVersion !== input.expectedPriceListVersion
  )
    throw new ApiError(
      409,
      'PRICE_CHANGED',
      'The price changed. Refresh and review before signing'
    );
  const id = randomUUID();
  return withAudit(
    db,
    {
      actor: input.actor,
      action: 'contract.signed',
      entityType: 'contract',
      entityId: id,
      details: result.price,
    },
    async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: input.assetId } });
      if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
      const reserved = await tx.asset.updateMany({
        where: { id: input.assetId, status: 'available' },
        data: { status: 'reserved' },
      });
      if (reserved.count !== 1)
        throw new ApiError(409, 'ASSET_UNAVAILABLE', 'Asset is unavailable');
      return tx.contract.create({ data: { id, actor: input.actor, ...result.price } });
    }
  );
}

export type SignApplicationInput = {
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  startOn: string;
  /** The customer's answers. The application is decided again here, from scratch. */
  answers: Answers;
  expectedMonthlyNetCents: number;
  expectedPriceListVersion: number;
};

export type SigningData = {
  lists: readonly PriceList[];
  table: CoefficientTable;
  vatRates: VatRates;
  questions: readonly Question[];
};

/**
 * The only way a customer signs: prices the lease for the signing day, re-runs the
 * application on the server, and signs only an approved one in the applicant's name.
 * A decision computed in the browser is never trusted.
 */
export async function signApplication(
  db: PrismaClient,
  input: SignApplicationInput,
  signedOn: string,
  data: SigningData
) {
  const asset = await getAsset(db, input.assetId);
  if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');

  const priced = priceContract(data.lists, data.table, input, signedOn);
  if (!priced.ok)
    throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced', priced.reason);
  const vat = vatRateOn(data.vatRates.rates, input.startOn);
  if (!vat.ok) throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced', vat.reason);
  const monthlyNet = priced.price.monthlyNetCents;

  const check = checkApplicationForSigning({
    questions: data.questions,
    deal: {
      category: asset.category,
      financedAmountCents: priced.price.financedCents,
      termMonths: input.termMonths,
      startDate: input.startOn,
    },
    answers: input.answers,
    monthlyRentWithVatCents: monthlyNet + vatCents(monthlyNet, vat.rate.rate_percent),
    coefficientTable: data.table,
  });
  if (!check.ok && check.reason === 'signatory_required')
    throw new ApiError(403, 'SIGNATORY_REQUIRED', 'Only the authorised signatory can sign');
  if (!check.ok)
    throw new ApiError(422, 'NOT_APPROVED', 'The application is not approved', check.reason);

  return signContract(db, { ...input, actor: check.signerName }, signedOn, data.lists, data.table);
}
