import { isoDateSchema } from '@/data/schemas';

/** End is exclusive. Clamp anniversaries to the final day of a shorter month. */
export function contractEndOn(startOn: string, termMonths: number): string {
  isoDateSchema.parse(startOn);
  if (!Number.isInteger(termMonths) || termMonths <= 0)
    throw new RangeError('Positive term required');
  const [year = 0, month = 0, day = 0] = startOn.split('-').map(Number);
  const index = year * 12 + month - 1 + termMonths;
  const endYear = Math.floor(index / 12);
  const endMonth = (index % 12) + 1;
  const leap = endYear % 4 === 0 && (endYear % 100 !== 0 || endYear % 400 === 0);
  const days = endMonth === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(endMonth) ? 30 : 31;
  return `${String(endYear).padStart(4, '0')}-${String(endMonth).padStart(2, '0')}-${String(Math.min(day, days)).padStart(2, '0')}`;
}
