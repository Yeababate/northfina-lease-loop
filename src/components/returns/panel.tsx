// A card-like section of the returns console.
import type { ReactNode } from 'react';

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-300 bg-white p-6 dark:border-stone-700 dark:bg-stone-900">
      {title ? <h2 className="mb-3 text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}
