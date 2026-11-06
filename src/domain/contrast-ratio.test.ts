import { describe, expect, it } from 'vitest';
import {
  WCAG_AA,
  contrastRatio,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
} from './contrast-ratio';

function ratio(a: string, b: string): number {
  const result = contrastRatio(a, b);
  if (!result.ok) throw new Error(`bad colour: ${a} / ${b}`);
  return result.ratio;
}

describe('parseHexColor', () => {
  it('reads six-digit hex in any case', () => {
    expect(parseHexColor('#2563eb')).toEqual({ r: 37, g: 99, b: 235 });
    expect(parseHexColor('#2563EB')).toEqual({ r: 37, g: 99, b: 235 });
  });

  it('expands three-digit hex', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#0a8')).toEqual({ r: 0, g: 170, b: 136 });
  });

  it('ignores surrounding spaces', () => {
    expect(parseHexColor('  #000000 ')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it.each([
    '',
    '#',
    'ffffff',
    '#ffff',
    '#fffffff',
    '#ggg',
    '#12345g',
    '#ffffff80',
    'red',
    'rgb(0,0,0)',
  ])('rejects %j', (input) => {
    expect(parseHexColor(input)).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it('uses the linear segment for very dark channels', () => {
    // 10/255 = 0.0392 is under the 0.04045 knee, so it is divided by 12.92.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 10);
  });
});

describe('contrastRatio', () => {
  it('is 1 for identical colours', () => {
    expect(ratio('#2563eb', '#2563eb')).toBe(1);
    expect(ratio('#fff', '#ffffff')).toBe(1);
  });

  it('is 21 for black on white, in either order', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(ratio('#ffffff', '#000')).toBeCloseTo(21, 10);
  });

  it('matches known WCAG values', () => {
    // #767676 is the classic lightest grey that passes 4.5:1 on white.
    expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(ratio('#777777', '#ffffff')).toBeLessThan(WCAG_AA.text);
  });

  it('reports a bad colour as a value, not an exception', () => {
    expect(contrastRatio('#fff', 'blue')).toEqual({ ok: false, reason: 'bad_colour' });
    expect(contrastRatio('', '#000')).toEqual({ ok: false, reason: 'bad_colour' });
  });
});

describe('meetsContrast', () => {
  it('passes at exactly the threshold and fails just under it', () => {
    expect(meetsContrast('#767676', '#fff', WCAG_AA.text)).toBe(true);
    expect(meetsContrast('#777777', '#fff', WCAG_AA.text)).toBe(false);
    // Identical colours give exactly 1, so a minimum of 1 is met and anything more is not.
    expect(meetsContrast('#abc', '#abc', 1)).toBe(true);
    expect(meetsContrast('#abc', '#abc', 1.01)).toBe(false);
  });

  it('is false for an invalid colour', () => {
    expect(meetsContrast('nope', '#fff', 1)).toBe(false);
  });
});
