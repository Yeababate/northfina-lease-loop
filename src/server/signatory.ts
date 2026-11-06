// Company contracts remain provisional until the named signatory accepts the current offer.
import { AWAITING_SIGNATURE, checkSignatorySignature, isNamedSignatory } from '@/domain/signatory';
import { priceLockNote } from '@/domain/application-signing';
import { priceContract } from '@/domain/contract-pricing';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import { vatCents, vatRateOn } from '@/domain/vat';
import type { Locale } from '@/i18n/locales';
import { ApiError } from './api-response';
import { assetPriceOverride } from './assets';
import { withAudit, type TransactionClient } from './audit';
import { findPendingPassOn, getPassOnPrice, completePassOnInTx } from './end-of-term';
import type { PriceOverride } from '@/domain/price-list';
import { rulesForAsset } from './discount-rules';
import type { PrismaClient } from './prisma-client';
import { renderContractPdf } from './contract-pdf';
import { rescheduleRemindersInTx } from './reminders/preferences';
import { isoDateSchema } from '@/data/schemas';

type Signer = { id: string; canonicalUsername: string };
type PendingContract = {
  id: string;
  actor: string;
  providerId: string | null;
  assetId: string;
  renterId: string | null;
  startOn: string;
  termMonths: number;
  downPaymentCents: number;
  priceListVersion: number;
  priceSource: string;
  monthlyNetCents: number;
  originalMonthlyNetCents: number | null;
  monthlyDiscountCents: number;
  discountBps: number;
  discountRuleId: string | null;
  discountRuleRevision: number | null;
  buyoutNetCents: number;
  listPriceCents: number;
  coefficientVersion: number;
  coefficientId: string;
  band: string;
  factor: number;
  financedCents: number;
  quotedPriceListVersion: number | null;
  signatoryEmail: string | null;
  lifecycle: { status: string } | null;
};

export type SignatoryPricingData = {
  lists: readonly PriceList[];
  table: CoefficientTable;
  vatRates: VatRates;
};

export type SignatoryOfferSnapshot = {
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  startOn: string;
  monthlyNetCents: number;
  originalMonthlyNetCents: number;
  monthlyDiscountCents: number;
  discountBps: number;
  buyoutNetCents: number;
  monthlyGrossCents: number;
  vatPercent: number;
  priceListVersion: number;
  priceSource: string;
  listPriceCents: number;
  discountRuleId: string | null;
  discountRuleRevision: number | null;
  coefficientVersion: number;
  coefficientId: string;
  band: string;
  factor: number;
  financedCents: number;
};

/** A contract the signed-in person may see as its named signatory, or null. */
export async function contractForSignatory(db: PrismaClient, signer: Signer, contractId: string) {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    include: { lines: true, lifecycle: true },
  });
  return contract && isNamedSignatory(contract.signatoryEmail, signer.canonicalUsername)
    ? contract
    : null;
}

async function offerForContract(
  db: Pick<PrismaClient, 'asset' | 'assetOwnership' | 'discountRule' | 'provider'>,
  contract: PendingContract | null,
  today: string,
  data: SignatoryPricingData,
  startOn?: string,
  passOnPrice?: PriceOverride
) {
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  const asset = await db.asset.findUnique({ where: { id: contract.assetId } });
  if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  const priced = priceContract(
    data.lists,
    data.table,
    {
      assetId: contract.assetId,
      termMonths: contract.termMonths,
      downPaymentCents: contract.downPaymentCents,
      startOn: startOn ?? contract.startOn,
    },
    today,
    await rulesForAsset(db, contract.assetId),
    passOnPrice ?? assetPriceOverride(asset)
  );
  if (!priced.ok) return { ok: false as const, reason: priced.reason };
  const vat = vatRateOn(data.vatRates.rates, priced.price.startOn);
  if (!vat.ok) return { ok: false as const, reason: vat.reason };
  const price = priced.price;
  const snapshot: SignatoryOfferSnapshot = {
    assetId: price.assetId,
    termMonths: price.termMonths,
    downPaymentCents: price.downPaymentCents,
    startOn: price.startOn,
    monthlyNetCents: price.monthlyNetCents,
    originalMonthlyNetCents: price.originalMonthlyNetCents,
    monthlyDiscountCents: price.monthlyDiscountCents,
    discountBps: price.discountBps,
    buyoutNetCents: price.buyoutNetCents,
    monthlyGrossCents:
      price.monthlyNetCents + vatCents(price.monthlyNetCents, vat.rate.rate_percent),
    vatPercent: vat.rate.rate_percent,
    priceListVersion: price.priceListVersion,
    priceSource: price.priceSource,
    listPriceCents: price.listPriceCents,
    discountRuleId: price.discountRuleId,
    discountRuleRevision: price.discountRuleRevision,
    coefficientVersion: price.coefficientVersion,
    coefficientId: price.coefficientId,
    band: price.band,
    factor: price.factor,
    financedCents: price.financedCents,
  };
  return {
    ok: true as const,
    snapshot,
    price,
    offerChanged:
      price.startOn !== contract.startOn ||
      price.monthlyNetCents !== contract.monthlyNetCents ||
      price.buyoutNetCents !== contract.buyoutNetCents ||
      price.priceListVersion !== contract.priceListVersion ||
      price.priceSource !== contract.priceSource ||
      price.listPriceCents !== contract.listPriceCents ||
      price.originalMonthlyNetCents !== contract.originalMonthlyNetCents ||
      price.monthlyDiscountCents !== contract.monthlyDiscountCents ||
      price.discountBps !== contract.discountBps ||
      price.discountRuleId !== contract.discountRuleId ||
      price.discountRuleRevision !== contract.discountRuleRevision ||
      price.coefficientVersion !== contract.coefficientVersion ||
      price.coefficientId !== contract.coefficientId ||
      price.band !== contract.band ||
      price.factor !== contract.factor,
    note: priceLockNote(
      {
        priceListVersion: contract.priceListVersion,
        priceSource: contract.priceSource as 'price_list' | 'next_life',
        monthlyNetCents: contract.monthlyNetCents,
      },
      price
    ),
  };
}

/**
 * A company pass-on waiting for this signature (#78): the old lease it replaces and the
 * next-life price, re-checked so a withdrawn or ended offer cannot be signed.
 */
async function pendingPassOn(
  db: PrismaClient | TransactionClient,
  contract: PendingContract,
  today: string,
  data: SignatoryPricingData
) {
  const choice = await findPendingPassOn(db, contract.id);
  if (!choice) return undefined;
  if (!contract.renterId)
    throw new ApiError(409, 'PASS_ON_UNAVAILABLE', 'This item cannot be passed on now');
  const price = await getPassOnPrice(
    db,
    choice.contractId,
    contract.assetId,
    contract.renterId,
    today,
    {
      lists: data.lists,
      table: data.table,
      pendingContractId: contract.id,
    }
  );
  return { contractId: choice.contractId, ...price };
}

export async function signatoryOffer(
  db: PrismaClient,
  signer: Signer,
  contractId: string,
  today: string,
  data: SignatoryPricingData,
  startOn?: string
) {
  const contract = await contractForSignatory(db, signer, contractId);
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  const check = checkSignatorySignature(
    { status: contract.lifecycle?.status ?? 'active', signatoryEmail: contract.signatoryEmail },
    signer.canonicalUsername
  );
  if (!check.ok)
    throw new ApiError(409, 'NOT_WAITING_FOR_SIGNATURE', 'This contract is not waiting for you');
  if (startOn !== undefined && !isoDateSchema.safeParse(startOn).success)
    throw new ApiError(422, 'INVALID_START_DATE', 'Choose a valid lease start date');
  const passOn = await pendingPassOn(db, contract, today, data);
  return offerForContract(db, contract, today, data, startOn, passOn);
}

function sameOffer(left: SignatoryOfferSnapshot, right: SignatoryOfferSnapshot) {
  return (Object.keys(left) as (keyof SignatoryOfferSnapshot)[]).every(
    (key) => left[key] === right[key]
  );
}

export async function signAsSignatory(
  db: PrismaClient,
  signer: Signer,
  contractId: string,
  today: string,
  data: SignatoryPricingData,
  expected: SignatoryOfferSnapshot
) {
  const contract = await contractForSignatory(db, signer, contractId);
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  const check = checkSignatorySignature(
    { status: contract.lifecycle?.status ?? 'active', signatoryEmail: contract.signatoryEmail },
    signer.canonicalUsername
  );
  if (!check.ok)
    throw new ApiError(409, 'NOT_WAITING_FOR_SIGNATURE', 'This contract is not waiting for you');
  if (expected.startOn < today)
    throw new ApiError(409, 'PRICE_CHANGED', 'Choose and review a new lease start date');
  const passOn = await pendingPassOn(db, contract, today, data);
  const preview = await offerForContract(db, contract, today, data, expected.startOn, passOn);
  if (!preview.ok)
    throw new ApiError(422, 'INVALID_PRICE', 'The lease can no longer be priced for signing');
  if (!sameOffer(preview.snapshot, expected))
    throw new ApiError(409, 'PRICE_CHANGED', 'Refresh and review the current offer before signing');

  return withAudit(
    db,
    {
      actor: signer.id,
      action: 'contract.signatory_signed',
      entityType: 'contract',
      entityId: contractId,
      details: {
        signatoryEmail: contract.signatoryEmail,
        signedOn: today,
        previousStartOn: contract.startOn,
        lockedStartOn: expected.startOn,
        quotedPriceListVersion: contract.quotedPriceListVersion,
        lockedPriceListVersion: preview.price.priceListVersion,
        previousMonthlyNetCents: contract.monthlyNetCents,
        lockedMonthlyNetCents: preview.price.monthlyNetCents,
        passOnContractId: passOn?.contractId ?? null,
      },
    },
    async (tx) => {
      const current = await tx.contract.findUnique({
        where: { id: contractId },
        include: { lifecycle: true },
      });
      if (
        !current ||
        !isNamedSignatory(current.signatoryEmail, signer.canonicalUsername) ||
        current.lifecycle?.status !== AWAITING_SIGNATURE
      )
        throw new ApiError(
          409,
          'NOT_WAITING_FOR_SIGNATURE',
          'This contract is not waiting for you'
        );
      if ((await tx.invoice.count({ where: { contractId } })) > 0)
        throw new ApiError(409, 'INVOICES_ALREADY_ISSUED', 'Issued invoices prevent repricing');
      const currentPassOn = await pendingPassOn(tx, current, today, data);
      const currentOffer = await offerForContract(
        tx,
        current,
        today,
        data,
        expected.startOn,
        currentPassOn
      );
      if (!currentOffer.ok)
        throw new ApiError(422, 'INVALID_PRICE', 'The lease can no longer be priced for signing');
      if (!sameOffer(currentOffer.snapshot, expected))
        throw new ApiError(
          409,
          'PRICE_CHANGED',
          'Refresh and review the current offer before signing'
        );
      const asset = await tx.asset.findUnique({ where: { id: current.assetId } });
      const provider = current.providerId
        ? await tx.demoUser.findUnique({ where: { id: current.providerId } })
        : null;
      const savedDocument = await tx.contractDocument.findUnique({
        where: { contractId },
      });
      if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
      const document = await renderContractPdf({
        ...currentOffer.price,
        id: contractId,
        actor: current.actor,
        providerName: provider?.displayName ?? '',
        assetName: `${asset.make} ${asset.model}`,
        serialNumber: asset.serial_number,
        locale: (savedDocument?.locale ?? 'en') as Locale,
        originalMonthlyNetCents: currentOffer.price.originalMonthlyNetCents,
        monthlyDiscountCents: currentOffer.price.monthlyDiscountCents,
        discountBps: currentOffer.price.discountBps,
        generatedAt: new Date().toISOString(),
      });
      const { assetId, ...lockedPrice } = currentOffer.price;
      const updated = await tx.contract.update({
        where: { id: contractId },
        data: {
          ...lockedPrice,
          assetId,
          signedOn: today,
          lockedPriceListVersion: lockedPrice.priceListVersion,
          signatorySignedOn: today,
        },
      });
      const line = await tx.contractLine.updateMany({
        where: { contractId, assetId },
        data: {
          listPriceCents: lockedPrice.listPriceCents,
          downPaymentCents: lockedPrice.downPaymentCents,
          financedCents: lockedPrice.financedCents,
          monthlyNetCents: lockedPrice.monthlyNetCents,
          buyoutNetCents: lockedPrice.buyoutNetCents,
          priceListVersion: lockedPrice.priceListVersion,
          priceSource: lockedPrice.priceSource,
          coefficientVersion: lockedPrice.coefficientVersion,
          coefficientId: lockedPrice.coefficientId,
          band: lockedPrice.band,
          factor: lockedPrice.factor,
        },
      });
      if (line.count !== 1)
        throw new ApiError(
          409,
          'CONTRACT_LINE_CHANGED',
          'The contract lines changed before signing'
        );
      if (savedDocument) {
        await tx.contractDocument.update({ where: { contractId }, data: document });
      } else {
        await tx.contractDocument.create({ data: { contractId, ...document } });
      }
      if (current.endOn !== updated.endOn)
        await rescheduleRemindersInTx(tx, contractId, updated.endOn, new Date());
      const activated = await tx.contractLifecycle.updateMany({
        where: { contractId, status: AWAITING_SIGNATURE },
        data: { status: 'active', revision: { increment: 1 } },
      });
      if (activated.count !== 1)
        throw new ApiError(
          409,
          'NOT_WAITING_FOR_SIGNATURE',
          'This contract is not waiting for you'
        );
      // Card 6 pass-on (#78): the handover completes only now, inside the same signature.
      if (currentPassOn)
        await completePassOnInTx(tx, {
          contractId: currentPassOn.contractId,
          nextContractId: contractId,
          assetId: current.assetId,
          endOn: currentPassOn.endOn,
          today,
          priceCents: currentPassOn.priceCents,
        });
      return { ...updated, lifecycle: { status: 'active' } };
    }
  );
}
