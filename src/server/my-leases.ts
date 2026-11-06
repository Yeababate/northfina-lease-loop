// Read adapter for the "My leases" page: the signed-in customer's own leases, each with what
// its card shows, plus their combined CO2 estimate. Read-only. The rules (lease month, next
// invoice, phase, the estimate itself) are pure functions in src/domain.
import type { Asset, VatRates } from '@/data/schemas';
import {
  combineEstimates,
  type CombinedEstimate,
  type ImpactEstimateResult,
} from '@/domain/co2-impact';
import { invoicePrice } from '@/domain/contract-pricing';
import { leaseMonthOn, nextInvoiceOn, previousDay } from '@/domain/lease-overview';
import { isCompletedLease, leasePhase, type LeasePhase } from '@/domain/profile-leases';
import { AWAITING_SIGNATURE } from '@/domain/signatory';
import { getAsset } from './assets';
import { estimateForAsset, type ImpactInputs } from './impact';
import type { PrismaClient } from './prisma-client';
import { listParticipantContracts } from './profile';

export type LeaseCardView = {
  id: string;
  /** The leased items: one for a single item, several for a bundle. */
  items: { id: string; make: string | null; model: string | null }[];
  phase: LeasePhase;
  completed: boolean;
  /** An early end the customer asked for, still waiting for the provider. */
  endingEarly: boolean;
  /** Card 6: the company signatory this contract waits for, or null once signed. */
  awaitingSignatory: string | null;
  month: number;
  termMonths: number;
  startOn: string;
  lastDay: string;
  monthlyNetCents: number;
  /** With today's VAT; null when no rate covers today. */
  monthlyGrossCents: number | null;
  nextInvoice: { invoiceDate: string; grossCents: number } | null;
  buyoutNetCents: number;
  hasDocument: boolean;
};

export type MyLeases = {
  current: LeaseCardView[];
  past: LeaseCardView[];
  /** Null when the CO2 data cannot be used or there is nothing leased. */
  impact: CombinedEstimate | null;
};

export async function loadMyLeases(
  db: PrismaClient,
  userId: string,
  today: string,
  vat: VatRates,
  impactInputs: ImpactInputs | null
): Promise<MyLeases> {
  const contracts = (await listParticipantContracts(db, userId)).filter(
    (contract) => contract.renterId === userId
  );
  const ids = contracts.map((contract) => contract.id);
  const [pendingExits, documents] = await Promise.all([
    db.exitRequest.findMany({
      where: { contractId: { in: ids }, status: 'pending' },
      select: { contractId: true },
    }),
    db.contractDocument.findMany({
      where: { contractId: { in: ids } },
      select: { contractId: true },
    }),
  ]);
  const endingEarly = new Set(pendingExits.map((row) => row.contractId));
  const withDocument = new Set(documents.map((row) => row.contractId));

  const assetIds = [
    ...new Set(
      contracts.flatMap((contract) =>
        contract.lines.length > 0 ? contract.lines.map((line) => line.assetId) : [contract.assetId]
      )
    ),
  ];
  const assets = new Map<string, Asset>();
  for (const asset of await Promise.all(assetIds.map((id) => getAsset(db, id)))) {
    if (asset) assets.set(asset.id, asset);
  }

  const estimates: ImpactEstimateResult[] = [];
  const cards = contracts.map((contract): LeaseCardView => {
    const lineIds =
      contract.lines.length > 0 ? contract.lines.map((line) => line.assetId) : [contract.assetId];
    if (impactInputs) {
      for (const id of lineIds) {
        const asset = assets.get(id);
        if (asset) estimates.push(estimateForAsset(asset, contract.termMonths, impactInputs));
      }
    }
    const gross = invoicePrice(contract, vat, today);
    return {
      id: contract.id,
      items: lineIds.map((id) => ({
        id,
        make: assets.get(id)?.make ?? null,
        model: assets.get(id)?.model ?? null,
      })),
      phase: leasePhase(contract, today),
      completed: isCompletedLease(contract),
      endingEarly: endingEarly.has(contract.id),
      awaitingSignatory:
        contract.lifecycle?.status === AWAITING_SIGNATURE ? contract.signatoryEmail : null,
      month: leaseMonthOn(contract, today),
      termMonths: contract.termMonths,
      startOn: contract.startOn,
      lastDay: previousDay(contract.lifecycle?.actualEndOn ?? contract.endOn),
      monthlyNetCents: contract.monthlyNetCents,
      monthlyGrossCents: gross.ok ? gross.totalCents : null,
      nextInvoice: nextInvoiceOn(contract, vat, today),
      buyoutNetCents: contract.buyoutNetCents,
      hasDocument: withDocument.has(contract.id),
    };
  });

  // Newest first in each group.
  const byStartDesc = (a: LeaseCardView, b: LeaseCardView) =>
    b.startOn.localeCompare(a.startOn) || a.id.localeCompare(b.id);
  return {
    current: cards.filter((card) => card.phase !== 'ended').sort(byStartDesc),
    past: cards.filter((card) => card.phase === 'ended').sort(byStartDesc),
    impact: impactInputs && estimates.length > 0 ? combineEstimates(estimates) : null,
  };
}
