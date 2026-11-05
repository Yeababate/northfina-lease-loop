// Calendar helpers for ISO dates (`YYYY-MM-DD`), done on the strings so no clock or time
// zone is involved. Two ISO dates compare correctly as plain strings.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True for a real calendar day written as `YYYY-MM-DD` (so `2026-02-30` is false). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Age in whole years on `onDate`. A birthday counts on the day itself.
 *
 * Someone born on 29 February turns a year older on 1 March in years without a
 * 29 February: comparing `MM-DD` strings, `02-28` comes before `02-29`. For an
 * "at least 18" rule that is the cautious choice.
 */
export function ageOn(birthDate: string, onDate: string): number {
  if (!isIsoDate(birthDate) || !isIsoDate(onDate)) {
    throw new RangeError(`ageOn needs ISO dates, got "${birthDate}" and "${onDate}"`);
  }
  const years = Number(onDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  const birthdayPassed = onDate.slice(5) >= birthDate.slice(5);
  return birthdayPassed ? years : years - 1;
}
