import { isoDateSchema } from '@/data/schemas';
import { earlyExitPeriod } from './early-exit-period';
import {
  BUYOUT_METHOD,
  CANCELLATION_METHOD,
  calculateEarlyBuyoutPrice,
  calculateEarlyCancellationFee,
} from './early-exit-price';

export type ExitKind = 'return' | 'buyout';
export type ExitContract = Readonly<{
  id: string;
  renterId: string | null;
  providerId: string | null;
  startOn: string;
  endOn: string;
  termMonths: number;
  monthlyNetCents: number;
  buyoutNetCents: number;
  status: string;
  revision: number;
}>;

export type ExitQuote = {
  contractId: string;
  kind: ExitKind;
  effectiveEndOn: string;
  periodStartOn: string;
  elapsedMonths: number;
  remainingMonths: number;
  monthlyRentCents: number;
  amountNetCents: number;
  method: string;
  contractRevision: number;
};

type PricePolicy = {
  cancellation: typeof calculateEarlyCancellationFee;
  buyout: typeof calculateEarlyBuyoutPrice;
  cancellationMethod: string;
  buyoutMethod: string;
};

const defaultPolicy: PricePolicy = {
  cancellation: calculateEarlyCancellationFee,
  buyout: calculateEarlyBuyoutPrice,
  cancellationMethod: CANCELLATION_METHOD,
  buyoutMethod: BUYOUT_METHOD,
};

/** A quote concerns the exit price only: existing rent and unclassified tax aren't invented. */
export function previewEarlyExit(
  contract: ExitContract,
  kind: ExitKind,
  userId: string,
  requestedOn: string,
  policy: PricePolicy = defaultPolicy
):
  | { ok: true; quote: ExitQuote }
  | {
      ok: false;
      reason:
        'not_renter' | 'not_active' | 'participants_missing' | 'not_started' | 'already_ended';
    } {
  if (!contract.renterId || !contract.providerId)
    return { ok: false, reason: 'participants_missing' };
  if (userId !== contract.renterId) return { ok: false, reason: 'not_renter' };
  if (contract.status !== 'active') return { ok: false, reason: 'not_active' };
  const result = earlyExitPeriod(contract, requestedOn);
  if (!result.ok) return result;
  const input = { monthlyRentCents: contract.monthlyNetCents, ...result.period };
  const amountNetCents =
    kind === 'return'
      ? policy.cancellation(input)
      : policy.buyout({ ...input, endOfTermBuyoutCents: contract.buyoutNetCents });
  if (!Number.isSafeInteger(amountNetCents) || amountNetCents < 0) {
    throw new RangeError('The exit policy must return nonnegative safe cents');
  }
  return {
    ok: true,
    quote: {
      contractId: contract.id,
      kind,
      ...result.period,
      monthlyRentCents: contract.monthlyNetCents,
      amountNetCents,
      method: kind === 'return' ? policy.cancellationMethod : policy.buyoutMethod,
      contractRevision: contract.revision,
    },
  };
}

/** Exact accepted input comparison; stale amounts/periods/methods need a fresh preview. */
export function sameExitQuote(a: ExitQuote, b: ExitQuote): boolean {
  return (
    a.contractId === b.contractId &&
    a.kind === b.kind &&
    a.effectiveEndOn === b.effectiveEndOn &&
    a.periodStartOn === b.periodStartOn &&
    a.elapsedMonths === b.elapsedMonths &&
    a.remainingMonths === b.remainingMonths &&
    a.monthlyRentCents === b.monthlyRentCents &&
    a.amountNetCents === b.amountNetCents &&
    a.method === b.method &&
    a.contractRevision === b.contractRevision
  );
}

/** Physical receipt alone does not end rent early or complete only part of a bundle. */
export function returnCanComplete(
  effectiveEndOn: string,
  assetIds: readonly string[],
  receivedAssetIds: readonly string[],
  balancesReviewed: boolean,
  today: string
): boolean {
  isoDateSchema.parse(today);
  isoDateSchema.parse(effectiveEndOn);
  return (
    balancesReviewed &&
    today >= effectiveEndOn &&
    assetIds.length > 0 &&
    new Set(assetIds).size === assetIds.length &&
    assetIds.every((id) => receivedAssetIds.includes(id))
  );
}
