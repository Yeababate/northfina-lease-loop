import { describe, expect, it } from 'vitest';
import { formatEuro, parseEuroInput } from './money';

describe('parseEuroInput', () => {
  const cents = (text: string) => {
    const result = parseEuroInput(text);
    return result.ok ? result.cents : null;
  };

  it('reads whole euros, with or without thousands separators', () => {
    expect(cents('2500')).toBe(250_000);
    expect(cents('2 500')).toBe(250_000);
    expect(cents('2,500')).toBe(250_000);
    expect(cents('2.500')).toBe(250_000);
    expect(cents('1 250 000')).toBe(125_000_000);
  });

  it('reads one or two decimals with a comma or a dot', () => {
    expect(cents('2500,50')).toBe(250_050);
    expect(cents('2500.5')).toBe(250_050);
    expect(cents('2,500.50')).toBe(250_050);
    expect(cents('2.500,05')).toBe(250_005);
  });

  it('ignores € signs and no-break spaces', () => {
    expect(cents('€ 2 500')).toBe(250_000);
    expect(cents('2 500 €')).toBe(250_000);
  });

  it('accepts zero', () => {
    expect(cents('0')).toBe(0);
  });

  it('refuses empty, negative, words and too many decimals', () => {
    for (const bad of ['', '   ', '-100', 'abc', '12a', '2500,505', ',50', '2,50,0']) {
      expect(parseEuroInput(bad), bad).toEqual({ ok: false });
    }
  });

  it('refuses amounts too big to count in cents exactly', () => {
    expect(parseEuroInput('99999999999999999')).toEqual({ ok: false });
  });
});

// Intl uses no-break spaces; compare with plain spaces so the tests are readable.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('formatEuro', () => {
  it('formats Finnish style: space as thousands separator, comma decimals, € after', () => {
    expect(plain(formatEuro(189_900, 'fi'))).toBe('1 899,00 €');
    expect(plain(formatEuro(25_000_000, 'fi-FI'))).toBe('250 000,00 €');
  });

  it('formats English style: € first, comma thousands, dot decimals', () => {
    expect(formatEuro(189_900, 'en')).toBe('€1,899.00');
    expect(formatEuro(28_900, 'en-GB')).toBe('€289.00');
  });

  it('shows single cents and zero correctly', () => {
    expect(plain(formatEuro(5, 'fi'))).toBe('0,05 €');
    expect(formatEuro(0, 'en')).toBe('€0.00');
  });

  it('formats negative amounts such as credit notes', () => {
    expect(formatEuro(-1_250, 'en')).toBe('-€12.50');
  });

  it('throws on fractions of a cent', () => {
    expect(() => formatEuro(10.5, 'en')).toThrow(RangeError);
  });
});
