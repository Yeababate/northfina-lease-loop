import { describe, expect, it } from 'vitest';
import { AWAITING_SIGNATURE, checkSignatorySignature, isNamedSignatory } from './signatory';

describe('isNamedSignatory', () => {
  it('matches the email the way sign-in does: trimmed and case-insensitive', () => {
    expect(isNamedSignatory('Signatory@Norvi.example.com', 'signatory@norvi.example.com')).toBe(
      true
    );
    expect(isNamedSignatory(' signatory@norvi.example.com ', 'signatory@norvi.example.com')).toBe(
      true
    );
  });

  it('does not match anyone else, or a missing email', () => {
    expect(isNamedSignatory('signatory@norvi.example.com', 'norvi')).toBe(false);
    expect(isNamedSignatory(null, 'norvi')).toBe(false);
    expect(isNamedSignatory('   ', '')).toBe(false);
  });
});

describe('checkSignatorySignature', () => {
  const waiting = { status: AWAITING_SIGNATURE, signatoryEmail: 'signatory@norvi.example.com' };

  it('lets the named signatory sign a waiting contract', () => {
    expect(checkSignatorySignature(waiting, 'signatory@norvi.example.com')).toEqual({ ok: true });
  });

  it('refuses the applicant and anyone else', () => {
    expect(checkSignatorySignature(waiting, 'norvi')).toEqual({
      ok: false,
      reason: 'not_signatory',
    });
  });

  it('refuses once it is signed (or never waited)', () => {
    expect(
      checkSignatorySignature({ ...waiting, status: 'active' }, 'signatory@norvi.example.com')
    ).toEqual({ ok: false, reason: 'not_waiting' });
  });
});
