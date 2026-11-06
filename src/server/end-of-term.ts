import { loadResidualCurves, loadVatRates } from '@/data/load';
import type { CoefficientTable, PriceList, ResidualCurves } from '@/data/schemas';
import { endOfTermBuyout, endOfTermOptions, type EndTermKind } from '@/domain/end-of-term';
import { AWAITING_SIGNATURE } from '@/domain/signatory';
import { ApiError } from './api-response';
import { toAsset } from './assets';
import { withAudit, type TransactionClient } from './audit';
import { assertOwnedAssets, assertParticipant, loadExitContract } from './exit-data';
import { priceNextLife } from './next-life-pricing';
import type { PrismaClient } from './prisma-client';

type Reader = PrismaClient | TransactionClient;

export async function readEndTermView(
  db: PrismaClient,
  contractId: string,
  userId: string,
  today: string
) {
  const [{ context, contract }, choice, vat] = await Promise.all([
    loadExitContract(db, contractId),
    db.endTermChoice.findUnique({ where: { contractId } }),
    loadVatRates(),
  ]);
  if (choice?.nomineeId === userId)
    return {
      role: 'nominee' as const,
      assetId: contract.assetId,
      endOn: context.endOn,
      completedOn: choice.completedOn,
    };
  assertParticipant(context, userId);
  const buyout = endOfTermBuyout(context.buyoutNetCents, today, vat);
  return {
    role: context.renterId === userId ? ('renter' as const) : ('provider' as const),
    ...endOfTermOptions(context, today, vat),
    choice,
    buyout: buyout.ok ? buyout.price : null,
  };
}

export async function chooseEndTerm(
  db: PrismaClient,
  input: { contractId: string; userId: string; kind: EndTermKind; nomineeId?: string },
  today: string
) {
  const { contractId, userId, kind, nomineeId } = input;
  const vat = await loadVatRates();
  return withAudit(
    db,
    {
      actor: userId,
      action: 'end_term.chosen',
      entityType: 'contract',
      entityId: contractId,
      details: { kind },
    },
    async (tx) => {
      const { context, assetIds } = await loadExitContract(tx, contractId);
      if (context.renterId !== userId)
        throw new ApiError(403, 'NOT_RENTER', 'Only the renter can choose');
      const options = endOfTermOptions(context, today, vat);
      if (!context.providerId || !options.options?.[kind])
        throw new ApiError(422, 'END_TERM_NOT_AVAILABLE', 'End-of-term choices are unavailable');

      const [choice, exit, receipt] = await Promise.all([
        tx.endTermChoice.findUnique({ where: { contractId } }),
        tx.exitRequest.findUnique({ where: { openContractId: contractId } }),
        tx.returnIntake.findFirst({ where: { contractId } }),
      ]);
      if (choice || exit || receipt)
        throw new ApiError(
          409,
          'ENDING_ALREADY_CHOSEN',
          'This lease already has an ending in progress'
        );
      await assertOwnedAssets(tx, assetIds, context.providerId);
      if (kind === 'pass_on') {
        if (
          assetIds.length !== 1 ||
          !nomineeId ||
          nomineeId === userId ||
          nomineeId === context.providerId ||
          !(await tx.demoUser.findUnique({ where: { id: nomineeId }, select: { id: true } }))
        )
          throw new ApiError(422, 'INVALID_NOMINEE', 'Choose another demo renter for the item');
      }
      return tx.endTermChoice.create({
        data: {
          contractId,
          kind,
          requestedOn: today,
          nomineeId: kind === 'pass_on' ? nomineeId : null,
        },
      });
    }
  );
}

export async function withdrawEndTerm(db: PrismaClient, contractId: string, userId: string) {
  return withAudit(
    db,
    { actor: userId, action: 'end_term.withdrawn', entityType: 'contract', entityId: contractId },
    async (tx) => {
      const { context } = await loadExitContract(tx, contractId);
      if (context.renterId !== userId)
        throw new ApiError(403, 'NOT_RENTER', 'Only the renter can withdraw');
      if (await tx.returnIntake.findFirst({ where: { contractId } }))
        throw new ApiError(409, 'END_TERM_CHANGED', 'The item has already been received');
      // A pass-on lease still waiting for the company's signatory is cancelled with the offer,
      // so it can never be signed into a second active lease for the same item (#78).
      const pending = await tx.endTermChoice.findUnique({ where: { contractId } });
      if (pending?.nextContractId && !pending.completedOn)
        await tx.contractLifecycle.updateMany({
          where: { contractId: pending.nextContractId, status: AWAITING_SIGNATURE },
          data: { status: 'cancelled', revision: { increment: 1 } },
        });
      const withdrawn = await tx.endTermChoice.deleteMany({
        where: { contractId, completedOn: null },
      });
      if (!withdrawn.count)
        throw new ApiError(409, 'END_TERM_CHANGED', 'There is no pending choice');
      return { withdrawn: true };
    }
  );
}

export async function completeEndTermBuyout(
  db: PrismaClient,
  contractId: string,
  userId: string,
  expectedGrossCents: number,
  today: string
) {
  const vat = await loadVatRates();
  const details: { settlement?: unknown } = {};
  return withAudit(
    db,
    {
      actor: userId,
      action: 'end_term.buyout_paid',
      entityType: 'contract',
      entityId: contractId,
      details,
    },
    async (tx) => {
      const { context, assetIds } = await loadExitContract(tx, contractId);
      if (context.providerId !== userId)
        throw new ApiError(403, 'NOT_PROVIDER', 'Only the provider can confirm payment');
      const choice = await tx.endTermChoice.findUnique({ where: { contractId } });
      if (
        context.status !== 'active' ||
        !choice ||
        choice.kind !== 'end_buyout' ||
        choice.completedOn ||
        today < context.endOn ||
        !context.renterId
      )
        throw new ApiError(409, 'END_TERM_CHANGED', 'The buyout is not ready for completion');
      const settlement = endOfTermBuyout(context.buyoutNetCents, today, vat);
      if (!settlement.ok || settlement.price.grossCents !== expectedGrossCents)
        throw new ApiError(409, 'QUOTE_CHANGED', 'Review the current buyout price');
      await assertOwnedAssets(tx, assetIds, userId);
      for (const assetId of assetIds) {
        await recordEndTermLife(tx, contractId, assetId, 'end_buyout', today);
        await tx.asset.update({
          where: { id: assetId },
          data: { ownerId: context.renterId, previous_lives: { increment: 1 } },
        });
        await tx.assetOwnership.deleteMany({ where: { assetId, providerId: userId } });
      }
      details.settlement = settlement.price;
      await markContractEnded(tx, contractId, 'completed_buyout', context.endOn);
      await tx.endTermChoice.update({
        where: { contractId },
        data: { completedOn: today, settlementJson: JSON.stringify(settlement.price) },
      });
      return settlement.price;
    }
  );
}

export async function getPassOnPrice(
  db: Reader,
  contractId: string,
  assetId: string,
  renterId: string,
  today: string,
  data: {
    lists: readonly PriceList[];
    table: CoefficientTable;
    curves?: ResidualCurves;
    /** The new lease already waiting for its company signatory, when pricing that signature. */
    pendingContractId?: string;
  }
) {
  const [{ context, assetIds }, choice, asset] = await Promise.all([
    loadExitContract(db, contractId),
    db.endTermChoice.findUnique({ where: { contractId } }),
    db.asset.findUnique({ where: { id: assetId } }),
  ]);
  if (!choice || choice.kind !== 'pass_on' || choice.nomineeId !== renterId)
    throw new ApiError(404, 'PASS_ON_NOT_FOUND', 'Pass-on offer not found');
  if (
    choice.completedOn ||
    // Only one new lease per pass-on: a pending one blocks any other application (#78).
    (choice.nextContractId ?? null) !== (data.pendingContractId ?? null) ||
    context.status !== 'active' ||
    today < context.endOn ||
    assetIds.length !== 1 ||
    assetIds[0] !== assetId ||
    asset?.status !== 'reserved' ||
    asset.ownerId !== context.providerId
  )
    throw new ApiError(409, 'PASS_ON_UNAVAILABLE', 'This item cannot be passed on now');
  const price = await priceNextLife(db, toAsset(asset), today, {
    ...data,
    curves: data.curves ?? (await loadResidualCurves()),
  });
  if (!price.ok)
    throw new ApiError(
      422,
      'INVALID_NEXT_LIFE_PRICE',
      'This item cannot be priced for its next lease',
      price.reason
    );
  return { priceCents: price.priceCents, pricedOn: today, endOn: context.endOn };
}

/**
 * Card 6 pass-on (#78): link the new company lease to the offer without completing anything.
 * The old lease stays active and the item held until the named signatory signs.
 */
export async function linkPendingPassOnInTx(
  tx: TransactionClient,
  contractId: string,
  nextContractId: string
) {
  const linked = await tx.endTermChoice.updateMany({
    where: { contractId, kind: 'pass_on', completedOn: null, nextContractId: null },
    data: { nextContractId },
  });
  if (linked.count !== 1)
    throw new ApiError(409, 'PASS_ON_UNAVAILABLE', 'This item cannot be passed on now');
}

/** The open pass-on offer whose new lease is waiting for its signatory, or null. */
export function findPendingPassOn(db: Reader, nextContractId: string) {
  return db.endTermChoice.findFirst({
    where: { nextContractId, kind: 'pass_on', completedOn: null },
  });
}

export async function completePassOnInTx(
  tx: TransactionClient,
  input: {
    contractId: string;
    nextContractId: string;
    assetId: string;
    endOn: string;
    today: string;
    priceCents: number;
  }
) {
  const { contractId, nextContractId, assetId, endOn, today, priceCents } = input;
  await markContractEnded(tx, contractId, 'passed_on', endOn);
  await recordEndTermLife(tx, contractId, assetId, 'pass_on', today);
  await tx.endTermChoice.update({
    where: { contractId },
    data: { completedOn: today, nextContractId },
  });
  await tx.asset.update({
    where: { id: assetId },
    data: {
      nextLifePriceCents: priceCents,
      nextLifePricedOn: today,
      previous_lives: { increment: 1 },
    },
  });
}

export async function completeEndTermReturnInTx(
  tx: TransactionClient,
  contractId: string,
  assetId: string,
  today: string
) {
  const choice = await tx.endTermChoice.findUnique({ where: { contractId } });
  if (choice?.kind !== 'end_return' || choice.completedOn) return;
  const contract = await tx.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: { endOn: true },
  });
  await markContractEnded(tx, contractId, 'completed_return', contract.endOn);
  await recordEndTermLife(tx, contractId, assetId, 'end_return', today);
  await tx.endTermChoice.update({ where: { contractId }, data: { completedOn: today } });
}

async function markContractEnded(
  tx: TransactionClient,
  contractId: string,
  status: string,
  actualEndOn: string
) {
  const lifecycle = await tx.contractLifecycle.findUnique({ where: { contractId } });
  if (lifecycle && lifecycle.status !== 'active')
    throw new ApiError(409, 'CONTRACT_COMPLETED', 'This lease is already complete');
  await tx.contractLifecycle.upsert({
    where: { contractId },
    create: { contractId, status, actualEndOn, revision: 1 },
    update: { status, actualEndOn, revision: { increment: 1 } },
  });
}

function recordEndTermLife(
  tx: TransactionClient,
  contractId: string,
  assetId: string,
  kind: EndTermKind,
  today: string
) {
  return tx.assetLifeCompletion.create({
    data: { id: `${contractId}:${assetId}`, contractId, assetId, kind, completedOn: today },
  });
}
