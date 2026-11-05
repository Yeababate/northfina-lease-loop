// Money helpers. Amounts are always integer euro cents; only format at the edge (the UI).

/**
 * Formats cents as euros for a locale, e.g. 189900 → "1 899,00 €" (fi) or "€1,899.00" (en).
 * `locale` is a BCP 47 tag such as "fi", "fi-FI" or "en-GB".
 */
export function formatEuro(cents: number, locale: string): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`cents must be a whole number, got ${cents}`);
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** Whole euros without cents, for slider ends and filters: 15000 → "€15,000" (en). */
export function formatWholeEuros(euros: number, locale: string): string {
  if (!Number.isInteger(euros)) throw new RangeError(`euros must be whole, got ${euros}`);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(euros);
}

export type ParseEurosResult = { ok: true; cents: number } | { ok: false };

/**
 * Reads a euro amount typed by a person into cents, without floating point:
 * "2500", "2 500", "2500,50", "2,500.50", "€ 2.500,5" → cents. Spaces and € are ignored.
 * A separator followed by exactly 1–2 digits at the end is the decimal mark; any other
 * separator groups thousands. Negative amounts and more than 2 decimals are refused.
 */
export function parseEuroInput(text: string): ParseEurosResult {
  const cleaned = text.replace(/[\s€]/g, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) return { ok: false };

  const decimal = /[.,](\d{1,2})$/.exec(cleaned);
  const wholePart = decimal ? cleaned.slice(0, decimal.index) : cleaned;
  // Thousands groups must be exactly three digits: "2,50,0" is a typo, not 2500.
  if (!/^\d{1,3}([.,]\d{3})*$/.test(wholePart) && !/^\d+$/.test(wholePart)) return { ok: false };

  const euros = Number(wholePart.replace(/[.,]/g, ''));
  const cents = decimal ? Number(decimal[1]!.padEnd(2, '0')) : 0;
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) ? { ok: true, cents: total } : { ok: false };
}
