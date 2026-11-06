import { describe, expect, it } from 'vitest';
import { averageText, filledStars } from './rating-display';

describe('filledStars', () => {
  it('rounds the average half up to whole stars', () => {
    expect(filledStars(10)).toBe(1);
    expect(filledStars(44)).toBe(4);
    expect(filledStars(45)).toBe(5);
    expect(filledStars(0)).toBe(0);
  });

  it('never goes above five', () => {
    expect(filledStars(55)).toBe(5);
  });

  it('rejects fractions and negatives', () => {
    expect(() => filledStars(4.5)).toThrow(RangeError);
    expect(() => filledStars(-1)).toThrow(RangeError);
  });
});

describe('averageText', () => {
  it('shows one decimal with the language’s decimal sign', () => {
    expect(averageText(45, 'en-GB')).toBe('4.5');
    expect(averageText(50, 'en-GB')).toBe('5.0');
    expect(averageText(45, 'fi-FI')).toBe('4,5');
    expect(averageText(37, 'sv-SE')).toBe('3,7');
  });

  it('rejects fractions', () => {
    expect(() => averageText(4.5, 'en-GB')).toThrow(RangeError);
  });
});
