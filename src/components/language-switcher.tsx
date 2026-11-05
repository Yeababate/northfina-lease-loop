'use client';

// A language dropdown that keeps you on the same page and filters: /fi/items/x?term=24 →
// /en/items/x?term=24. A client component because it navigates when the choice changes.
import { usePathname, useRouter } from 'next/navigation';
import { useId } from 'react';
import { isLocale, localeNames, locales, type Locale } from '@/i18n/locales';

export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const id = useId();

  function switchTo(locale: string) {
    if (!isLocale(locale) || locale === current) return;
    const rest = pathname.split('/').slice(2).join('/');
    // Read the query at click time, so this component needs no Suspense boundary.
    router.push(`/${locale}${rest ? `/${rest}` : ''}${window.location.search}`);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-stone-600 dark:text-stone-400">
        {label}
      </label>
      <select
        id={id}
        value={current}
        onChange={(event) => switchTo(event.target.value)}
        className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {localeNames[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
