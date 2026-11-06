// WCAG 2.2 contrast ratio between two sRGB colours, used to check the design tokens in
// `src/app/globals.css`. Formula: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio

export type Rgb = { r: number; g: number; b: number };

export type ContrastResult = { ok: true; ratio: number } | { ok: false; reason: 'bad_colour' };

/** Minimum ratios for WCAG 2.2 level AA. */
export const WCAG_AA = {
  /** Normal body text (SC 1.4.3). */
  text: 4.5,
  /** Large text (≥ 24px, or ≥ 18.66px bold), controls, focus rings and icons (SC 1.4.3, 1.4.11). */
  nonText: 3,
} as const;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Reads `#rgb` or `#rrggbb` (any case, surrounding spaces ignored). Anything else, including
 * an alpha channel, gives `null`: a translucent colour has no single contrast ratio.
 */
export function parseHexColor(input: string): Rgb | null {
  const hex = input.trim();
  if (!HEX.test(hex)) return null;
  const digits =
    hex.length === 4
      ? [...hex.slice(1)].map((digit) => digit + digit)
      : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  const [r, g, b] = digits.map((pair) => Number.parseInt(pair, 16));
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
}

/** One sRGB channel (0–255) to linear light, as WCAG defines it. */
function linearChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance: 0 for black, 1 for white. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/**
 * Contrast ratio from 1 (identical) to 21 (black on white). The order of the two colours
 * does not matter. The ratio is not rounded: compare it to the threshold as is, because
 * WCAG says 4.499 does not pass 4.5.
 */
export function contrastRatio(first: string, second: string): ContrastResult {
  const a = parseHexColor(first);
  const b = parseHexColor(second);
  if (a === null || b === null) return { ok: false, reason: 'bad_colour' };
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return { ok: true, ratio: (lighter + 0.05) / (darker + 0.05) };
}

/** True when both colours are valid and their ratio reaches `minimum`. */
export function meetsContrast(first: string, second: string, minimum: number): boolean {
  const result = contrastRatio(first, second);
  return result.ok && result.ratio >= minimum;
}
