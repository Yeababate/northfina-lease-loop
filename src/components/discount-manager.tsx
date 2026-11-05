'use client';

import { useState } from 'react';
import { discountRevisionKey } from '@/domain/dealer-discount';
import { toScaledInteger } from '@/domain/rounding';
import { formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import type { DealerDiscountView } from '@/server/dealer-discount';

export function DiscountManager({
  providers,
  locale,
  initialProviderId = '',
  initialView = null,
}: {
  providers: { id: string; displayName: string }[];
  locale: Locale;
  initialProviderId?: string;
  initialView?: DealerDiscountView | null;
}) {
  const t = getT(locale);
  const [providerId, setProvider] = useState(initialProviderId);
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);

  async function save(form: HTMLFormElement) {
    if (!view || busy) return;
    const fields = new FormData(form);
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch('/api/dealer-discount', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minTermMonths: Number(fields.get('threshold')),
          discountBps: toScaledInteger(Number(fields.get('percent')), 100),
          enabled: fields.get('enabled') === 'on',
          expectedRules: view.setting.expectedRules,
          confirmReplacement: fields.get('replace') === 'on',
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error('Save failed');
      setView(result.data);
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  const saved = view?.setting;
  return (
    <div className="space-y-5">
      <p>{t('discount.simpleIntro')}</p>
      <label className="block">
        {t('discount.provider')}{' '}
        <select
          className="border p-2"
          disabled={busy}
          value={providerId}
          onChange={async (event) => {
            const id = event.target.value;
            setBusy(true);
            setStatus(null);
            setView(null);
            setProvider('');
            try {
              if (!id) {
                await fetch('/api/provider-session', { method: 'DELETE' });
                return;
              }
              const selected = await fetch('/api/provider-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: id }),
              });
              if (!selected.ok) throw new Error('Provider selection failed');
              const response = await fetch('/api/dealer-discount', { cache: 'no-store' });
              const result = await response.json();
              if (!response.ok || !result.success) throw new Error('Load failed');
              setView(result.data);
              setProvider(id);
            } catch {
              setStatus('error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="">{t('discount.chooseProvider')}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.displayName}
            </option>
          ))}
        </select>
      </label>
      {status && <p role={status === 'error' ? 'alert' : 'status'}>{t(`discount.${status}`)}</p>}
      {view && saved ? (
        <>
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">{t('discount.savedSetting')}</h2>
            <p>
              {saved.mode === 'empty'
                ? t('discount.notSaved')
                : saved.mode === 'legacy'
                  ? t('discount.legacySaved')
                  : t(saved.enabled ? 'discount.savedOffer' : 'discount.savedOff', {
                      percent: formatNumber(saved.discountBps / 100, locale),
                      months: saved.minTermMonths,
                    })}
            </p>
          </section>
          <OfferForm
            key={`${providerId}:${discountRevisionKey(saved.expectedRules)}`}
            view={view}
            locale={locale}
            busy={busy}
            onSave={save}
          />
        </>
      ) : (
        <p role="status">
          {t(providers.length ? 'discount.chooseProvider' : 'discount.noProviders')}
        </p>
      )}
    </div>
  );
}

function OfferForm({
  view,
  locale,
  busy,
  onSave,
}: {
  view: DealerDiscountView;
  locale: Locale;
  busy: boolean;
  onSave: (form: HTMLFormElement) => Promise<void>;
}) {
  const t = getT(locale);
  const setting = view.setting;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(event.currentTarget);
      }}
      className="rounded-lg border p-4"
    >
      <fieldset disabled={busy} className="space-y-4">
        <legend className="font-semibold">{t('discount.offerHeading')}</legend>
        {setting.mode === 'legacy' && (
          <div className="space-y-2 rounded border border-amber-300 p-3">
            <p>{t('discount.legacyWarning')}</p>
            <ul>
              {view.rules.map((rule) => (
                <li key={rule.id}>
                  {t('discount.legacyRow', {
                    percent: formatNumber(rule.discountBps / 100, locale),
                    min: rule.minTermMonths,
                    max: rule.maxTermMonths,
                    state: t(rule.enabled ? 'discount.on' : 'discount.off'),
                  })}
                </li>
              ))}
            </ul>
            <label className="block">
              <input type="checkbox" name="replace" required /> {t('discount.confirmReplacement')}
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span>{t('discount.offerStart')}</span>
          <label>
            <span className="sr-only">{t('discount.percent')}</span>
            <input
              className="w-24 rounded border p-2"
              name="percent"
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              required
              defaultValue={setting.discountBps / 100}
            />
          </label>
          <span>{t('discount.offerMiddle')}</span>
          <label>
            <span className="sr-only">{t('discount.threshold')}</span>
            <select
              className="rounded border p-2"
              name="threshold"
              defaultValue={setting.minTermMonths}
            >
              {view.terms.map((term) => (
                <option key={term} value={term}>
                  {t('term.months', { months: term })}
                </option>
              ))}
            </select>
          </label>
          <span>{t('discount.offerEnd')}</span>
        </div>
        <label className="block">
          <input type="checkbox" name="enabled" defaultChecked={setting.enabled} />{' '}
          {t('discount.offerEnabled')}
        </label>
        <p className="text-sm">{t('discount.policy')}</p>
        <button type="submit" className="rounded bg-emerald-800 px-3 py-2 text-white">
          {t(busy ? 'discount.saving' : 'discount.save')}
        </button>
      </fieldset>
    </form>
  );
}
