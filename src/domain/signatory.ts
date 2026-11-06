// Card 6: a company applicant who may not sign for the company sends the contract to the
// person who can (q_signatory_email). The contract is saved, the item reserved and the price
// held, but it is NOT signed and NOT active until that person signs. These are the rules.
import { demoParticipantName } from './demo-participant';

/** Lifecycle status of a contract sent to the company's signatory and not signed yet. */
export const AWAITING_SIGNATURE = 'awaiting_signature';

/** True when the signed-in participant is the named signatory (same rules as sign-in). */
export function isNamedSignatory(
  signatoryEmail: string | null,
  canonicalUsername: string
): boolean {
  if (!signatoryEmail) return false;
  const parsed = demoParticipantName(signatoryEmail);
  return parsed.ok && parsed.canonicalUsername === canonicalUsername;
}

/**
 * When a pass-on handover happens (#78). A lease the recipient signs themselves completes the
 * handover at once. A company lease waiting for its named signatory is not signed yet, so the
 * old lease, the end-of-term choice and the item's life count change only at that signature.
 */
export function passOnHandoverTiming(awaitingSignatory: boolean): 'now' | 'at_signatory_signature' {
  return awaitingSignatory ? 'at_signatory_signature' : 'now';
}

export type SignatoryCheck = { ok: true } | { ok: false; reason: 'not_waiting' | 'not_signatory' };

/** Whether this participant may sign this waiting contract now. */
export function checkSignatorySignature(
  contract: { status: string; signatoryEmail: string | null },
  canonicalUsername: string
): SignatoryCheck {
  if (contract.status !== AWAITING_SIGNATURE) return { ok: false, reason: 'not_waiting' };
  if (!isNamedSignatory(contract.signatoryEmail, canonicalUsername))
    return { ok: false, reason: 'not_signatory' };
  return { ok: true };
}
