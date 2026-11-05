// Small building blocks shared by every page, so buttons, badges and info boxes look the same
// everywhere. Plain functions and class strings: no state, no client JavaScript.
import type { ReactNode } from 'react';

export type BadgeTone = 'green' | 'orange' | 'blue' | 'neutral';

const badgeTones: Record<BadgeTone, string> = {
  green:
    'bg-green-50 text-green-800 ring-green-300 dark:bg-green-950 dark:text-green-200 dark:ring-green-800',
  orange:
    'bg-orange-50 text-orange-800 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800',
  blue: 'bg-blue-50 text-blue-800 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
  neutral:
    'bg-white text-stone-800 ring-stone-400 dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-600',
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

const buttonBase =
  'inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-center font-semibold transition-colors';

/** Filled blue: the one main action on a page. */
export const primaryButton = `${buttonBase} bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 dark:text-stone-950`;

/** Outlined: secondary actions and card buttons. */
export const secondaryButton = `${buttonBase} border border-stone-400 bg-white text-stone-900 hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800`;

export const textLink =
  'text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200';

/** Light blue panel for explanations: "Why we ask", "Why this price?". */
export function InfoBox({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-stone-800 dark:bg-blue-950/60 dark:text-stone-200">
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-0.5' : undefined}>{children}</div>
    </div>
  );
}

/** Stand-in for a product photo until the data pack has images. */
export function PhotoPlaceholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl bg-blue-50 text-sm text-stone-500 dark:bg-stone-800 dark:text-stone-400 ${className}`}
    >
      {label}
    </div>
  );
}
