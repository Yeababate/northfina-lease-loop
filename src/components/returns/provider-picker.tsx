'use client';

// Chooses which demo provider (dealer) the returns console acts for. A mock context switch
// through /api/provider-session, not authentication (see src/server/providers.ts).
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

type ProviderPickerProps = {
  locale: Locale;
  providers: { id: string; displayName: string }[];
  selectedId: string;
};

export function ProviderPicker({ locale, providers, selectedId }: ProviderPickerProps) {
  const t = getT(locale);
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(providerId: string) {
    setBusy(true);
    setFailed(false);
    try {
      const response = providerId
        ? await fetch('/api/provider-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerId }),
          })
        : await fetch('/api/provider-session', { method: 'DELETE' });
      if (!response.ok) setFailed(true);
      // Start from the new provider's own list, not an intake the old one selected.
      router.push(`/${locale}/returns`);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium">
        {t('returns.provider')}
      </label>{' '}
      <select
        id={id}
        value={selectedId}
        disabled={busy}
        aria-describedby={failed ? `${id}-error` : undefined}
        onChange={(event) => void choose(event.target.value)}
        className="ml-2 rounded-lg border border-stone-400 bg-white px-2 py-1.5 dark:border-stone-600 dark:bg-stone-900"
      >
        <option value="">{t('returns.noProvider')}</option>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.displayName}
          </option>
        ))}
      </select>
      {failed ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-red-700 dark:text-red-300">
          {t('returns.error.generic')}
        </p>
      ) : null}
    </div>
  );
}
