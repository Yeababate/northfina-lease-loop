// Checks the colour pairs the UI actually uses against WCAG 2.2 AA, with the token values
// read from globals.css, so changing a token there cannot silently break contrast.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WCAG_AA, contrastRatio } from '@/domain/contrast-ratio';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

function themeBlock(): string {
  const match = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!match?.[1]) throw new Error('No @theme block in globals.css');
  return match[1];
}

/** `--color-name: #hex;` declarations in the @theme block. */
const colors = new Map(
  [...themeBlock().matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]+);/gi)].map((m) => [
    m[1] ?? '',
    m[2] ?? '',
  ])
);

function token(name: string): string {
  const value = colors.get(name);
  if (value === undefined) throw new Error(`--color-${name} is not defined in globals.css`);
  return value;
}

function remToPx(name: string): number {
  const match = new RegExp(`--text-${name}:\\s*([0-9.]+)rem;`).exec(themeBlock());
  if (!match?.[1]) throw new Error(`--text-${name} is not defined in globals.css`);
  return Number(match[1]) * 16;
}

type Pair = [foreground: string, background: string, where: string];

/** Normal-size text: 4.5:1. */
const textPairs: Pair[] = [
  ['stone-900', 'white', 'body text'],
  ['stone-100', 'stone-950', 'body text, dark'],
  ['stone-600', 'white', 'muted text'],
  ['stone-600', 'stone-50', 'muted text on a tinted row'],
  ['stone-600', 'stone-100', 'muted text on a tinted row'],
  ['stone-600', 'blue-50', 'muted text in a blue panel'],
  ['stone-500', 'blue-50', 'image placeholder label'],
  ['stone-700', 'white', 'secondary text'],
  ['stone-800', 'blue-50', 'notice text'],
  ['stone-400', 'stone-950', 'muted text, dark'],
  ['stone-400', 'stone-900', 'muted text on a card, dark'],
  ['stone-400', 'stone-800', 'image placeholder label, dark'],
  ['stone-300', 'stone-900', 'secondary text, dark'],
  ['stone-200', 'blue-950', 'notice text, dark'],
  ['blue-700', 'white', 'links'],
  ['blue-700', 'blue-50', 'highlighted price'],
  ['blue-300', 'stone-950', 'links, dark'],
  ['blue-300', 'blue-950', 'highlighted price, dark'],
  ['white', 'blue-600', 'primary button'],
  ['white', 'blue-700', 'primary button, hover'],
  ['stone-950', 'blue-500', 'primary button, dark'],
  ['stone-950', 'blue-400', 'primary button, dark hover'],
  ['stone-900', 'white', 'secondary button'],
  ['stone-100', 'stone-900', 'secondary button, dark'],
  ['white', 'emerald-800', 'action button'],
  ['red-700', 'white', 'error message'],
  ['red-400', 'stone-950', 'error message, dark'],
  ['green-700', 'white', 'saving label'],
  ['green-400', 'stone-900', 'saving label, dark'],
  ['green-900', 'green-50', 'success notice'],
  ['green-100', 'green-950', 'success notice, dark'],
  ['green-800', 'green-50', 'green badge'],
  ['green-200', 'green-950', 'green badge, dark'],
  ['orange-800', 'orange-50', 'orange badge'],
  ['orange-200', 'orange-950', 'orange badge, dark'],
  ['orange-900', 'orange-100', 'demo badge'],
  ['blue-800', 'blue-50', 'blue badge'],
  ['blue-200', 'blue-950', 'blue badge, dark'],
  ['stone-800', 'white', 'neutral badge'],
  ['stone-200', 'stone-900', 'neutral badge, dark'],
];

/** Control borders, icons and focus rings: 3:1 against what is next to them. */
const nonTextPairs: Pair[] = [
  ['stone-400', 'white', 'input and secondary button border'],
  ['stone-600', 'stone-900', 'input border, dark'],
  ['stone-600', 'stone-950', 'input border on the page, dark'],
  ['blue-600', 'white', 'slider handle and progress bar'],
  ['blue-400', 'stone-900', 'progress bar, dark'],
  ['amber-500', 'white', 'rating stars'],
  ['amber-500', 'stone-900', 'rating stars, dark'],
  ['focus', 'white', 'focus ring'],
  ['focus', 'blue-50', 'focus ring in a blue panel'],
  ['focus', 'stone-50', 'focus ring on a tinted row'],
];

/** The dark-scheme focus ring, from the prefers-color-scheme block. */
function darkFocus(): string {
  const match = /prefers-color-scheme:\s*dark[\s\S]*?--color-focus:\s*(#[0-9a-f]+);/i.exec(css);
  if (!match?.[1]) throw new Error('No dark --color-focus in globals.css');
  return match[1];
}

function check(foreground: string, background: string, minimum: number): number {
  const result = contrastRatio(foreground, background);
  if (!result.ok) throw new Error(`Not a hex colour: ${foreground} / ${background}`);
  expect(result.ratio).toBeGreaterThanOrEqual(minimum);
  return result.ratio;
}

describe('design tokens in globals.css', () => {
  it('defines every colour as a hex value', () => {
    expect(colors.size).toBeGreaterThan(40);
  });

  it.each(textPairs)('text %s on %s (%s) is at least 4.5:1', (fg, bg) => {
    check(token(fg), token(bg), WCAG_AA.text);
  });

  it.each(nonTextPairs)('%s against %s (%s) is at least 3:1', (fg, bg) => {
    check(token(fg), token(bg), WCAG_AA.nonText);
  });

  it.each(['stone-950', 'stone-900', 'stone-800', 'blue-950'])(
    'the dark focus ring is at least 3:1 on %s',
    (bg) => {
      check(darkFocus(), token(bg), WCAG_AA.nonText);
    }
  );

  it('keeps the smallest text size at 14px or more', () => {
    expect(remToPx('xs')).toBeGreaterThanOrEqual(14);
  });
});
