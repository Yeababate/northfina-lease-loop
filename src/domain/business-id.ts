// Finnish business ID (Y-tunnus) check, used by the application's q_business_id question.
// Format: seven digits, a hyphen and one check digit, e.g. `3012456-5`.

export type BusinessIdResult =
  { ok: true } | { ok: false; reason: 'bad_format' | 'bad_check_digit' };

const FORMAT = /^(\d{7})-(\d)$/;

/** Weights of the seven digits, from the left, in the public Y-tunnus algorithm. */
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2] as const;

/**
 * Checks the format and the check digit of a Finnish business ID.
 *
 * Check digit: multiply the seven digits by 7, 9, 10, 5, 8, 4, 2, add the products and
 * take the remainder after dividing by 11. Remainder 0 gives check digit 0; remainder 1 is
 * never issued, so any ID with it is invalid; otherwise the check digit is 11 − remainder.
 *
 * Surrounding spaces are ignored. Old six-digit IDs must be written with a leading zero.
 */
export function checkBusinessId(input: string): BusinessIdResult {
  const match = FORMAT.exec(input.trim());
  const body = match?.[1];
  const given = match?.[2];
  if (body === undefined || given === undefined) return { ok: false, reason: 'bad_format' };

  const sum = WEIGHTS.reduce((total, weight, i) => total + weight * Number(body[i]), 0);
  const remainder = sum % 11;
  if (remainder === 1) return { ok: false, reason: 'bad_check_digit' };

  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected === Number(given) ? { ok: true } : { ok: false, reason: 'bad_check_digit' };
}
