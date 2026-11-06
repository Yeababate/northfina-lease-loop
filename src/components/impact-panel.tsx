// "Your impact": the illustrative CO2 estimate (src/domain/co2-impact.ts) in plain words.
// Two forms: one item on its price page, with the full breakdown, and the total of all your
// leases on "My leases". Server components: no client JavaScript; <details> opens natively.
import type { CombinedEstimate, ImpactEstimateResult } from '@/domain/co2-impact';
import { wholeKilograms } from '@/domain/lease-overview';
import { formatNumber } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

const panel = 'rounded-xl bg-blue-50/70 px-5 py-4 text-sm dark:bg-blue-950/40';
const summaryLink =
  'cursor-pointer text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200';

type Common = { locale: Locale; t: Translate };

/** One item's estimate, with what it is made of and what it assumes. */
export function ItemImpactPanel({
  result,
  locale,
  t,
}: Common & { result: ImpactEstimateResult | null }) {
  const kg = (grams: number) =>
    t('impact.kg', { kg: formatNumber(Math.abs(wholeKilograms(grams)), locale) });

  if (!result?.ok) {
    return (
      <section aria-labelledby="impact-title" className={panel}>
        <h2 id="impact-title" className="font-semibold">
          {t('impact.title')}
        </h2>
        <p className="mt-0.5">{t('impact.unavailable')}</p>
      </section>
    );
  }

  const { estimate } = result;
  const headline =
    estimate.outcome === 'saving'
      ? t('impact.saving', { kg: kg(estimate.estimatedSavingGrams) })
      : estimate.outcome === 'no_saving'
        ? t('impact.noSaving')
        : t('impact.additional', { kg: kg(estimate.estimatedSavingGrams) });
  const rows = [
    { label: t('impact.row.new'), value: kg(estimate.manufacturingBaselineGrams) },
    { label: t('impact.row.credited'), value: kg(estimate.creditedManufacturingGrams) },
    {
      label: t('impact.row.refurbishment'),
      value: `−${kg(estimate.refurbishmentAllowanceGrams)}`,
    },
  ];

  return (
    <section aria-labelledby="impact-title" className={panel}>
      <h2 id="impact-title" className="font-semibold">
        {t('impact.title')}
      </h2>
      <p className="mt-0.5">{headline}</p>
      <details className="mt-2">
        <summary className={summaryLink}>{t('impact.how')}</summary>
        <p className="mt-2">{t('impact.method')}</p>
        <dl className="mt-2 space-y-1">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt>{row.label}</dt>
              <dd className="tabular-nums">{row.value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-blue-200 pt-1 font-semibold dark:border-blue-900">
            <dt>{t('impact.row.saving')}</dt>
            <dd className="tabular-nums">
              {estimate.estimatedSavingGrams < 0 ? '−' : ''}
              {kg(estimate.estimatedSavingGrams)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 font-semibold">{t('impact.assumptions')}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {estimate.assumptions.map((code) => (
            <li key={code}>{t(`impact.assumption.${code}`)}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** The total over all of a customer's leases (the "Your impact" box on My leases). */
export function LeasesImpactPanel({
  combined,
  locale,
  t,
}: Common & { combined: CombinedEstimate }) {
  const total = wholeKilograms(combined.totalSavingGrams);
  return (
    <section
      aria-labelledby="impact-title"
      className={`${panel} flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6`}
    >
      <div>
        <h2 id="impact-title" className="font-semibold">
          {t('impact.title')}
        </h2>
        <p className="mt-0.5">
          {total >= 0
            ? t('impact.leasesSaving', { kg: t('impact.kg', { kg: formatNumber(total, locale) }) })
            : t('impact.leasesAdditional', {
                kg: t('impact.kg', { kg: formatNumber(-total, locale) }),
              })}
        </p>
        {combined.partial ? <p className="mt-1">{t('impact.partial')}</p> : null}
      </div>
      <details className="sm:max-w-sm">
        <summary className={`${summaryLink} sm:text-right`}>{t('impact.how')}</summary>
        <p className="mt-2">{t('impact.method')}</p>
      </details>
    </section>
  );
}
