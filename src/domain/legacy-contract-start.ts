import { isIsoDate } from './iso-date';
import { contractEndOn } from './contract-period';
import { invoiceSchedule } from './invoices';

export type LegacyStartEvidence = {
  signedOn: string;
  startOn?: string | null;
  endOn: string;
  termMonths: number;
  /** Verified from the originating release/audit, never inferred from matching dates alone. */
  provenance: 'original-signing-day-policy' | 'unknown';
  invoices: readonly { period: number; invoiceDate: string }[];
};

/** Dry-run only: propose a start date from evidence, or refuse to invent one. */
export function planLegacyContractStart(evidence: LegacyStartEvidence) {
  if (
    !isIsoDate(evidence.signedOn) ||
    !isIsoDate(evidence.endOn) ||
    !Number.isSafeInteger(evidence.termMonths) ||
    evidence.termMonths < 1 ||
    evidence.termMonths > 48
  )
    return { ok: false, reason: 'invalid_contract' } as const;
  if (evidence.startOn == null && evidence.provenance !== 'original-signing-day-policy')
    return { ok: false, reason: 'unknown_start' } as const;
  const startOn = evidence.startOn ?? evidence.signedOn;
  if (!isIsoDate(startOn) || startOn < evidence.signedOn)
    return { ok: false, reason: 'invalid_contract' } as const;
  if (contractEndOn(startOn, evidence.termMonths) !== evidence.endOn)
    return { ok: false, reason: 'inconsistent_end' } as const;
  const schedule = invoiceSchedule(startOn, evidence.termMonths);
  const seen = new Set<number>();
  for (const invoice of evidence.invoices) {
    if (
      seen.has(invoice.period) ||
      schedule[invoice.period - 1]?.invoiceDate !== invoice.invoiceDate
    )
      return { ok: false, reason: 'inconsistent_invoices' } as const;
    seen.add(invoice.period);
  }
  return {
    ok: true,
    startOn,
    source: evidence.startOn == null ? 'legacy_signing_policy' : 'stored',
  } as const;
}
