import { AWAITING_SIGNATURE } from '@/domain/signatory';
import { randomUUID } from 'node:crypto';
import type { VatRates } from '@/data/schemas';
import { calculateInvoices } from '@/domain/invoices';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

export async function listInvoices(db: PrismaClient, contractId: string) {
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  return db.invoice.findMany({ where: { contractId }, orderBy: { period: 'asc' } });
}

/** Generate the complete schedule, including future dated invoices; retries preserve rows. */
export async function generateInvoices(
  db: PrismaClient,
  contractId: string,
  actor: string,
  vat: VatRates
) {
  // Card 6: nothing is billed before the company's signatory has signed.
  const lifecycle = await db.contractLifecycle.findUnique({ where: { contractId } });
  if (lifecycle?.status === AWAITING_SIGNATURE)
    throw new ApiError(409, 'AWAITING_SIGNATURE', 'The contract is waiting for its signatory');
  return withAudit(
    db,
    {
      actor,
      action: 'invoices.generated',
      entityType: 'contract',
      entityId: contractId,
      details: { policy: 'advance-monthly-v1' },
    },
    async (tx) => {
      const contract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
      const existing = await tx.invoice.findMany({
        where: { contractId },
        orderBy: { period: 'asc' },
      });
      if (existing.length === contract.termMonths) return existing;
      const result = calculateInvoices(contract, vat);
      if (!result.ok)
        throw new ApiError(422, 'VAT_UNAVAILABLE', 'VAT is unavailable for this schedule');
      for (const row of result.invoices) {
        // The unique key is the final guard against repeated or concurrent generation.
        // Empty update preserves issued amounts even if VAT data later changes.
        await tx.invoice.upsert({
          where: { contractId_period: { contractId, period: row.period } },
          create: { id: randomUUID(), contractId, ...row },
          update: {},
        });
      }
      return tx.invoice.findMany({ where: { contractId }, orderBy: { period: 'asc' } });
    }
  );
}
