import { isoDateSchema } from '@/data/schemas';
import { contractEndOn } from './contract-period';

export type ExitPeriod = {
  periodStartOn: string;
  effectiveEndOn: string;
  elapsedMonths: number;
  remainingMonths: number;
};

/** Monthly anniversaries stay anchored to the original start, including January 31.
 * End dates are exclusive. The current period remains earned and is not prorated.
 */
export function earlyExitPeriod(
  contract: { startOn: string; endOn: string; termMonths: number },
  requestedOn: string
): { ok: true; period: ExitPeriod } | { ok: false; reason: 'not_started' | 'already_ended' } {
  isoDateSchema.parse(requestedOn);
  isoDateSchema.parse(contract.startOn);
  isoDateSchema.parse(contract.endOn);
  if (
    !Number.isSafeInteger(contract.termMonths) ||
    contract.termMonths <= 0 ||
    contract.termMonths > 1200
  ) {
    throw new RangeError('Supported positive whole term required');
  }
  if (contractEndOn(contract.startOn, contract.termMonths) !== contract.endOn) {
    throw new RangeError('Contract calendar does not match its signed term');
  }
  if (requestedOn < contract.startOn) return { ok: false, reason: 'not_started' };
  if (requestedOn >= contract.endOn) return { ok: false, reason: 'already_ended' };
  let start = contract.startOn;
  for (let elapsed = 1; elapsed <= contract.termMonths; elapsed++) {
    const end = contractEndOn(contract.startOn, elapsed);
    if (requestedOn < end) {
      return {
        ok: true,
        period: {
          periodStartOn: start,
          effectiveEndOn: end,
          elapsedMonths: elapsed,
          remainingMonths: contract.termMonths - elapsed,
        },
      };
    }
    start = end;
  }
  return { ok: false, reason: 'already_ended' };
}
