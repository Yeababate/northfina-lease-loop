import { randomUUID } from 'node:crypto';
import type { CoefficientTable, PriceList, Question, VatRates } from '@/data/schemas';
import type { Answers } from '@/domain/answer-check';
import { checkApplicationForSigning } from '@/domain/application-signing';
import { priceContract, type PricingInput } from '@/domain/contract-pricing';
import type { PriceSource } from '@/domain/price-list';
import { vatCents, vatRateOn } from '@/domain/vat';
import { AWAITING_SIGNATURE, passOnHandoverTiming } from '@/domain/signatory';
import { ApiError } from './api-response';
import { assetPriceOverride, toAsset } from './assets';
import { withAudit } from './audit';
import { rulesForAsset } from './discount-rules';
import { completePassOnInTx, getPassOnPrice, linkPendingPassOnInTx } from './end-of-term';
import type { PrismaClient } from './prisma-client';
import { renderContractPdf } from './contract-pdf';
import type { Locale } from '@/i18n/locales';
import {
  createReminderPreferencesInTx,
  validateReminderSetup,
  type InitialReminders,
} from './reminders/preferences';

/** Lease-end reminder settings saved with the contract, in the signing transaction (#10). */
export type SigningReminders = InitialReminders & { now: Date };

export type SigningParticipants = {
  renterId: string;
  providerId: string;
  providerName: string;
  locale: Locale;
};

/** No update operation is exposed: signing creates an immutable price snapshot. */
export async function signContract(
  db: PrismaClient,
  input: PricingInput & {
    actor: string;
    expectedMonthlyNetCents: number;
    expectedBuyoutNetCents: number;
    expectedPriceListVersion: number;
    expectedPriceSource?: PriceSource;
    expectedListPriceCents?: number;
    passOnContractId?: string;
    expectedDiscountRuleId?: string | null;
    expectedDiscountRuleRevision?: number | null;
    expectedCoefficientVersion?: number;
    expectedCoefficientId?: string;
    expectedBand?: string;
    expectedFactor?: number;
    expectedFinancedCents?: number;
    quoteId?: string;
    quotedPriceListVersion?: number;
    participants?: SigningParticipants;
    /**
     * Card 6: the company's signatory email when the applicant may not sign. The contract
     * is saved waiting for that person: reserved and priced, but not active until they sign.
     */
    awaitingSignatory?: string;
  },
  signedOn: string,
  lists: readonly PriceList[],
  table: CoefficientTable,
  reminders?: SigningReminders
) {
  const pricingInput = {
    assetId: input.assetId,
    termMonths: input.termMonths,
    downPaymentCents: input.downPaymentCents,
    startOn: input.startOn,
  };
  const [assetSnapshot, discountRules] = await Promise.all([
    db.asset.findUnique({ where: { id: input.assetId } }),
    rulesForAsset(db, input.assetId),
  ]);
  if (!assetSnapshot) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  const passOnId = input.passOnContractId;
  if (passOnId && !input.participants)
    throw new ApiError(401, 'LOGIN_REQUIRED', 'Select the nominated demo renter first');
  const passOnPrice =
    passOnId && input.participants
      ? await getPassOnPrice(db, passOnId, input.assetId, input.participants.renterId, signedOn, {
          lists,
          table,
        })
      : undefined;
  const result = priceContract(
    lists,
    table,
    pricingInput,
    signedOn,
    discountRules,
    passOnPrice ?? assetPriceOverride(assetSnapshot)
  );
  if (!result.ok)
    throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced', result.reason);
  if (
    result.price.monthlyNetCents !== input.expectedMonthlyNetCents ||
    result.price.buyoutNetCents !== input.expectedBuyoutNetCents ||
    result.price.priceListVersion !== input.expectedPriceListVersion ||
    result.price.priceSource !== (input.expectedPriceSource ?? 'price_list') ||
    (input.expectedListPriceCents !== undefined &&
      result.price.listPriceCents !== input.expectedListPriceCents) ||
    result.price.discountRuleId !== (input.expectedDiscountRuleId ?? null) ||
    result.price.discountRuleRevision !== (input.expectedDiscountRuleRevision ?? null) ||
    (input.expectedCoefficientVersion !== undefined &&
      result.price.coefficientVersion !== input.expectedCoefficientVersion) ||
    (input.expectedCoefficientId !== undefined &&
      result.price.coefficientId !== input.expectedCoefficientId) ||
    (input.expectedBand !== undefined && result.price.band !== input.expectedBand) ||
    (input.expectedFactor !== undefined && result.price.factor !== input.expectedFactor) ||
    (input.expectedFinancedCents !== undefined &&
      result.price.financedCents !== input.expectedFinancedCents)
  )
    throw new ApiError(
      409,
      'PRICE_CHANGED',
      'The price changed. Refresh and review before signing'
    );
  const id = randomUUID();
  const event = reminders && {
    contractId: id,
    recipientId: reminders.recipientId,
    endOn: result.price.endOn,
  };
  const reminderSetup =
    reminders && event ? validateReminderSetup(event, reminders.preferences, reminders.now) : null;
  const document = await renderContractPdf({
    ...result.price,
    id,
    actor: input.actor,
    providerName: input.participants?.providerName ?? '',
    assetName: `${assetSnapshot.make} ${assetSnapshot.model}`,
    serialNumber: assetSnapshot.serial_number,
    locale: input.participants?.locale ?? 'en',
    originalMonthlyNetCents: result.price.originalMonthlyNetCents,
    monthlyDiscountCents: result.price.monthlyDiscountCents,
    discountBps: result.price.discountBps,
    generatedAt: new Date().toISOString(),
  });
  const signingDetails: Record<string, unknown> = {
    ...result.price,
    ...(reminderSetup && { reminderPreferences: reminderSetup.preferences }),
    ...(passOnId && { passOnContractId: passOnId }),
    ...(input.awaitingSignatory && { awaitingSignatory: input.awaitingSignatory }),
  };
  return withAudit(
    db,
    {
      actor: input.participants?.renterId ?? input.actor,
      action: 'contract.signed',
      entityType: 'contract',
      entityId: id,
      details: signingDetails,
    },
    async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: input.assetId } });
      if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
      signingDetails.assetAtSigning = {
        condition: asset.condition,
        usage: { unit: asset.usage_unit, value: asset.usage_value },
      };
      const owner = await tx.assetOwnership.findUnique({ where: { assetId: input.assetId } });
      if (
        input.participants &&
        (asset.ownerId !== input.participants.providerId ||
          (owner !== null && owner.providerId !== input.participants.providerId))
      )
        throw new ApiError(409, 'PROVIDER_CHANGED', 'The provider changed. Review before signing');
      const currentPassOn =
        passOnId && input.participants
          ? await getPassOnPrice(
              tx,
              passOnId,
              input.assetId,
              input.participants.renterId,
              signedOn,
              { lists, table }
            )
          : undefined;
      const currentPrice = priceContract(
        lists,
        table,
        pricingInput,
        signedOn,
        await rulesForAsset(tx, input.assetId),
        currentPassOn ?? assetPriceOverride(asset)
      );
      if (!currentPrice.ok)
        throw new ApiError(
          422,
          'INVALID_PRICE',
          'This lease cannot be priced',
          currentPrice.reason
        );
      if (
        currentPrice.price.monthlyNetCents !== input.expectedMonthlyNetCents ||
        currentPrice.price.buyoutNetCents !== input.expectedBuyoutNetCents ||
        currentPrice.price.priceListVersion !== input.expectedPriceListVersion ||
        currentPrice.price.priceSource !== result.price.priceSource ||
        currentPrice.price.discountRuleId !== (input.expectedDiscountRuleId ?? null) ||
        currentPrice.price.discountRuleRevision !== (input.expectedDiscountRuleRevision ?? null) ||
        currentPrice.price.originalMonthlyNetCents !== result.price.originalMonthlyNetCents ||
        currentPrice.price.monthlyDiscountCents !== result.price.monthlyDiscountCents ||
        currentPrice.price.discountBps !== result.price.discountBps ||
        currentPrice.price.coefficientVersion !== result.price.coefficientVersion ||
        currentPrice.price.coefficientId !== result.price.coefficientId ||
        currentPrice.price.band !== result.price.band ||
        currentPrice.price.factor !== result.price.factor ||
        currentPrice.price.financedCents !== result.price.financedCents ||
        currentPrice.price.downPaymentCents !== result.price.downPaymentCents ||
        currentPrice.price.listPriceCents !== result.price.listPriceCents
      )
        throw new ApiError(
          409,
          'PRICE_CHANGED',
          'The price changed. Refresh and review before signing'
        );
      if (
        passOnId &&
        currentPassOn &&
        passOnHandoverTiming(Boolean(input.awaitingSignatory)) === 'at_signatory_signature'
      ) {
        await linkPendingPassOnInTx(tx, passOnId, id);
      } else if (passOnId && currentPassOn) {
        await completePassOnInTx(tx, {
          contractId: passOnId,
          nextContractId: id,
          assetId: asset.id,
          endOn: currentPassOn.endOn,
          today: signedOn,
          priceCents: currentPassOn.priceCents,
        });
      } else {
        const reserved = await tx.asset.updateMany({
          where: { id: input.assetId, status: 'available' },
          data: { status: 'reserved' },
        });
        if (reserved.count !== 1)
          throw new ApiError(409, 'ASSET_UNAVAILABLE', 'Asset is unavailable');
      }
      const { assetId, ...linePrice } = currentPrice.price;
      const contract = await tx.contract.create({
        data: {
          id,
          quoteId: input.quoteId ?? null,
          quotedPriceListVersion: input.quotedPriceListVersion ?? input.expectedPriceListVersion,
          lockedPriceListVersion: input.awaitingSignatory
            ? null
            : currentPrice.price.priceListVersion,
          actor: input.actor,
          ...currentPrice.price,
          renterId: input.participants?.renterId ?? null,
          providerId: input.participants?.providerId ?? null,
          lines: {
            create: {
              id: `${id}:${assetId}`,
              assetId,
              listPriceCents: linePrice.listPriceCents,
              downPaymentCents: linePrice.downPaymentCents,
              financedCents: linePrice.financedCents,
              monthlyNetCents: linePrice.monthlyNetCents,
              buyoutNetCents: linePrice.buyoutNetCents,
              priceListVersion: linePrice.priceListVersion,
              priceSource: linePrice.priceSource,
              coefficientVersion: linePrice.coefficientVersion,
              coefficientId: linePrice.coefficientId,
              band: linePrice.band,
              factor: linePrice.factor,
            },
          },
          signatoryEmail: input.awaitingSignatory ?? null,
          lifecycle: {
            create: input.awaitingSignatory ? { status: AWAITING_SIGNATURE } : {},
          },
          document: { create: document },
        },
      });
      // Record who provides this lease, from current ownership, in the same transaction.
      // The link never changes, so the provider keeps access after any later sale.
      const recordedProviderId = owner?.providerId ?? asset.ownerId;
      if (recordedProviderId)
        await tx.contractProvider.create({
          data: { contractId: id, providerId: recordedProviderId, assetId: input.assetId },
        });
      if (reminders && event && reminderSetup)
        await createReminderPreferencesInTx(
          tx,
          event,
          { ...reminders, preferences: reminderSetup.preferences },
          reminderSetup.schedule
        );
      return contract;
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
  expectedBuyoutNetCents: number;
  expectedPriceListVersion: number;
  expectedPriceSource?: PriceSource;
  expectedListPriceCents?: number;
  passOnContractId?: string;
  expectedDiscountRuleId?: string | null;
  expectedDiscountRuleRevision?: number | null;
  expectedCoefficientVersion?: number;
  expectedCoefficientId?: string;
  expectedBand?: string;
  expectedFactor?: number;
  expectedFinancedCents?: number;
  /** Optional for legacy application links created before quote persistence. */
  quoteId?: string;
  locale?: Locale;
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
  data: SigningData,
  principalId?: string,
  reminders?: SigningReminders
) {
  const savedQuote = input.quoteId
    ? await db.quote.findUnique({ where: { id: input.quoteId } })
    : null;
  if (input.quoteId) {
    if (!savedQuote || savedQuote.renterId !== principalId)
      throw new ApiError(404, 'QUOTE_NOT_FOUND', 'Quote not found');
    if (
      savedQuote.assetId !== input.assetId ||
      savedQuote.termMonths !== input.termMonths ||
      savedQuote.downPaymentCents !== input.downPaymentCents ||
      savedQuote.startOn !== input.startOn
    )
      throw new ApiError(
        409,
        'QUOTE_MISMATCH',
        'The application no longer matches its saved quote'
      );
    const previousContract = await db.contract.findUnique({ where: { quoteId: savedQuote.id } });
    if (previousContract) return previousContract;
  }
  const [assetRow, discountRules] = await Promise.all([
    db.asset.findUnique({ where: { id: input.assetId } }),
    rulesForAsset(db, input.assetId),
  ]);
  if (!assetRow) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  const asset = toAsset(assetRow);
  if (input.passOnContractId && !principalId)
    throw new ApiError(401, 'LOGIN_REQUIRED', 'Select the nominated demo renter first');
  const passOnPrice =
    input.passOnContractId && principalId
      ? await getPassOnPrice(db, input.passOnContractId, input.assetId, principalId, signedOn, data)
      : undefined;

  const priced = priceContract(
    data.lists,
    data.table,
    input,
    signedOn,
    discountRules,
    passOnPrice ?? assetPriceOverride(assetRow)
  );
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
  // Card 6: the applicant may not sign for the company. Save the contract waiting for the
  // named signatory instead of refusing, so the app can show what happens next.
  const awaitingSignatory =
    !check.ok && check.reason === 'signatory_required' ? check.signatoryEmail : undefined;
  if (!check.ok && check.reason === 'signatory_required' && !awaitingSignatory)
    throw new ApiError(403, 'SIGNATORY_REQUIRED', 'Only the authorised signatory can sign');
  if (!check.ok && !awaitingSignatory)
    throw new ApiError(422, 'NOT_APPROVED', 'The application is not approved', check.reason);

  let participants: SigningParticipants | undefined;
  if (principalId) {
    const [principal, ownedAsset, ownership] = await Promise.all([
      db.demoUser.findUnique({ where: { id: principalId } }),
      db.asset.findUnique({ where: { id: input.assetId } }),
      db.assetOwnership.findUnique({ where: { assetId: input.assetId } }),
    ]);
    if (!principal) throw new ApiError(401, 'LOGIN_REQUIRED', 'Select a demo username first');
    if (!ownedAsset?.ownerId || (ownership !== null && ownership.providerId !== ownedAsset.ownerId))
      throw new ApiError(422, 'PROVIDER_REQUIRED', 'The item has no configured provider');
    if (ownedAsset.ownerId === principal.id)
      throw new ApiError(422, 'OWN_ASSET', 'Choose an item from another provider');
    const provider = await db.demoUser.findUnique({ where: { id: ownedAsset.ownerId } });
    if (!provider)
      throw new ApiError(422, 'PROVIDER_REQUIRED', 'The item has no configured provider');
    participants = {
      renterId: principal.id,
      providerId: provider.id,
      providerName: provider.displayName,
      locale: input.locale ?? 'en',
    };
  }
  const companyName = input.answers.q_company_name;
  try {
    return await signContract(
      db,
      {
        ...input,
        actor: check.ok
          ? check.signerName
          : typeof companyName === 'string' && companyName.trim()
            ? companyName.trim()
            : 'Company',
        participants,
        awaitingSignatory,
        quoteId: savedQuote?.id,
        quotedPriceListVersion: savedQuote?.priceListVersion,
      },
      signedOn,
      data.lists,
      data.table,
      reminders
    );
  } catch (error) {
    // A concurrent retry can lose the asset-reservation race after the other request
    // committed this quote. Return that immutable contract rather than inviting a duplicate.
    if (savedQuote) {
      const completed = await db.contract.findUnique({ where: { quoteId: savedQuote.id } });
      if (completed && completed.renterId === principalId) return completed;
    }
    throw error;
  }
}
