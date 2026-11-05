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
    participants?: SigningParticipants;
  },
  signedOn: string,
  lists: readonly PriceList[],
  table: CoefficientTable,
  reminders?: SigningReminders
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
    result.price.buyoutNetCents !== input.expectedBuyoutNetCents ||
    result.price.priceListVersion !== input.expectedPriceListVersion
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
  const assetSnapshot = await db.asset.findUnique({ where: { id: input.assetId } });
  if (!assetSnapshot) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  const document = await renderContractPdf({
    ...result.price,
    id,
    actor: input.actor,
    providerName: input.participants?.providerName ?? '',
    assetName: `${assetSnapshot.make} ${assetSnapshot.model}`,
    serialNumber: assetSnapshot.serial_number,
    locale: input.participants?.locale ?? 'en',
    generatedAt: new Date().toISOString(),
  });
  return withAudit(
    db,
    {
      actor: input.participants?.renterId ?? input.actor,
      action: 'contract.signed',
      entityType: 'contract',
      entityId: id,
      details: reminderSetup
        ? { ...result.price, reminderPreferences: reminderSetup.preferences }
        : result.price,
    },
    async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: input.assetId } });
      if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
      if (input.participants && asset.ownerId !== input.participants.providerId)
        throw new ApiError(409, 'PROVIDER_CHANGED', 'The provider changed. Review before signing');
      const reserved = await tx.asset.updateMany({
        where: { id: input.assetId, status: 'available' },
        data: { status: 'reserved' },
      });
      if (reserved.count !== 1)
        throw new ApiError(409, 'ASSET_UNAVAILABLE', 'Asset is unavailable');
      const { assetId, ...linePrice } = result.price;
      const contract = await tx.contract.create({
        data: {
          id,
          actor: input.actor,
          ...result.price,
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
              coefficientVersion: linePrice.coefficientVersion,
              coefficientId: linePrice.coefficientId,
              band: linePrice.band,
              factor: linePrice.factor,
            },
          },
          lifecycle: { create: {} },
          document: { create: document },
        },
      });
      // Record who provides this lease, from current ownership, in the same transaction.
      // The link never changes, so the provider keeps access after any later sale.
      const owner = await tx.assetOwnership.findUnique({ where: { assetId: input.assetId } });
      if (owner)
        await tx.contractProvider.create({
          data: { contractId: id, providerId: owner.providerId, assetId: input.assetId },
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

  let participants: SigningParticipants | undefined;
  if (principalId) {
    const [principal, ownedAsset] = await Promise.all([
      db.demoUser.findUnique({ where: { id: principalId } }),
      db.asset.findUnique({ where: { id: input.assetId } }),
    ]);
    if (!principal) throw new ApiError(401, 'LOGIN_REQUIRED', 'Select a demo username first');
    if (!ownedAsset?.ownerId)
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
  return signContract(
    db,
    { ...input, actor: check.signerName, participants },
    signedOn,
    data.lists,
    data.table,
    reminders
  );
}
