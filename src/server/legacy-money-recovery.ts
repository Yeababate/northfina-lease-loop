import type { Asset, AuditLog, Contract, Invoice } from '@/generated/prisma/client';
import { planLegacyContractStart } from '@/domain/legacy-contract-start';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

export type LegacyMoneySnapshot = {
  assets: Asset[];
  audits: AuditLog[];
  contracts: (Omit<Contract, 'startOn'> & { startOn?: string | null })[];
  invoices: Invoice[];
};

/**
 * Offline side-by-side recovery into an EMPTY, fully migrated database only.
 * No source connection is accepted, so the source and its migration ledger stay intact.
 * The operator must verify provenance before listing an id in originalPolicyIds.
 */
export async function restoreLegacyMoneySnapshot(
  target: PrismaClient,
  snapshot: LegacyMoneySnapshot,
  originalPolicyIds: readonly string[],
  actor: string
) {
  const contracts = snapshot.contracts.map((contract) => {
    const plan = planLegacyContractStart({
      ...contract,
      provenance: originalPolicyIds.includes(contract.id)
        ? 'original-signing-day-policy'
        : 'unknown',
      invoices: snapshot.invoices.filter((invoice) => invoice.contractId === contract.id),
    });
    if (!plan.ok)
      throw new Error(`Start date requires review for contract ${contract.id}: ${plan.reason}`);
    return { ...contract, startOn: plan.startOn };
  });
  return withAudit(
    target,
    {
      actor,
      action: 'database.legacy_money_restored',
      entityType: 'database',
      entityId: 'legacy-money',
      details: {
        contractCount: contracts.length,
        invoiceCount: snapshot.invoices.length,
        originalPolicyIds,
      },
    },
    async (tx) => {
      const occupied = await Promise.all([
        tx.asset.count(),
        tx.contract.count(),
        tx.invoice.count(),
        tx.auditLog.count(),
      ]);
      if (occupied.some((count) => count !== 0)) throw new Error('Recovery target must be empty');
      // Preserve original ids, timestamps, amounts, statuses and existing audit details.
      await tx.asset.createMany({ data: snapshot.assets });
      await tx.contract.createMany({ data: contracts });
      await tx.invoice.createMany({ data: snapshot.invoices });
      await tx.auditLog.createMany({ data: snapshot.audits });
      return { contracts: contracts.length, invoices: snapshot.invoices.length };
    }
  );
}
