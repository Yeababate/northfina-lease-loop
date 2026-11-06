'use client';

// The filter sidebar. It is a plain GET form, so it works without JavaScript (press
// "Show items"); with JavaScript, ticking a box or picking from a list applies at once.
import Form from 'next/form';
import Link from 'next/link';
import type { FormEvent } from 'react';
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import type { CatalogueQuery, CatalogueSort, PriceSlider } from '@/domain/catalogue';
import type { MessageKey } from '@/i18n/get-t';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { PriceRangeSlider } from './price-range-slider';
import { secondaryButton, textLink } from './ui';

export const CATALOGUE_FORM_ID = 'catalogue-filters';

type CatalogueFiltersProps = {
  locale: Locale;
  query: CatalogueQuery;
  categories: readonly AssetCategory[];
  conditions: readonly AssetCondition[];
  terms: readonly number[];
  today: string;
  /** Kept while browsing one provider's deals (from the Deals page). */
  provider?: string;
  /** The price slider's range for the chosen categories. */
  slider: PriceSlider;
};

const fieldClass =
  'w-full rounded-lg border border-stone-400 bg-white px-3 py-2 text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100';

export function CatalogueFilters(props: CatalogueFiltersProps) {
  const { locale, query, categories, conditions, terms, today, slider } = props;
  const t = getT(locale);

  // Free-text fields wait for Enter or the button; choices apply as soon as they change.
  // The price slider applies itself when a handle is let go, not on every step of a drag.
  function applyChoice(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement;
    if (['text', 'number', 'search', 'range'].includes(target.type)) return;
    event.currentTarget.requestSubmit();
  }

  return (
    <Form
      id={CATALOGUE_FORM_ID}
      action={`/${locale}`}
      onChange={applyChoice}
      aria-label={t('filters.title')}
      className="space-y-6"
    >
      {props.provider ? <input type="hidden" name="provider" value={props.provider} /> : null}
      <div>
        <label htmlFor="filter-q" className="font-semibold">
          {t('filters.search')}
        </label>
        <input
          id="filter-q"
          name="q"
          type="search"
          defaultValue={query.search}
          placeholder={t('filters.searchPlaceholder')}
          className={`${fieldClass} mt-2`}
        />
      </div>

      <CheckboxGroup
        legend={t('filters.category')}
        name="category"
        options={categories.map((c) => ({ value: c, label: t(`category.${c}`) }))}
        checked={query.categories}
      />
      <CheckboxGroup
        legend={t('condition.label')}
        name="condition"
        options={conditions.map((c) => ({ value: c, label: t(`condition.${c}` as MessageKey) }))}
        checked={query.conditions}
      />

      <PriceRangeSlider
        // A new URL (for example "Clear all filters") resets the handles.
        key={`${query.minPriceEuros}-${query.maxPriceEuros}-${slider.topEuros}`}
        minEuros={query.minPriceEuros}
        maxEuros={query.maxPriceEuros}
        slider={slider}
        locale={locale}
        t={t}
      />

      <fieldset className="space-y-3">
        <legend className="font-semibold">{t('filters.lease')}</legend>
        <div>
          <label htmlFor="filter-start" className="text-sm">
            {t('filters.startDate')}
          </label>
          <input
            id="filter-start"
            name="start"
            type="date"
            min={today}
            defaultValue={query.startDate}
            className={`${fieldClass} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="filter-term" className="text-sm">
            {t('filters.termLength')}
          </label>
          <select
            id="filter-term"
            name="term"
            defaultValue={query.termMonths}
            className={`${fieldClass} mt-1`}
          >
            {terms.map((months) => (
              <option key={months} value={months}>
                {t('term.months', { months })}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-stone-600 dark:text-stone-400">{t('filters.termHint')}</p>
      </fieldset>

      <div className="flex flex-col items-start gap-3">
        <button type="submit" className={secondaryButton}>
          {t('filters.apply')}
        </button>
        <Link href={`/${locale}`} className={textLink}>
          {t('filters.clear')}
        </Link>
      </div>
    </Form>
  );
}

/**
 * The sort list above the results. It belongs to the sidebar form through the `form`
 * attribute, so sorting keeps every filter; changes there do not bubble to the form itself.
 */
export function SortSelect(props: {
  label: string;
  value: CatalogueSort;
  options: { value: CatalogueSort; label: string }[];
}) {
  return (
    <div className="flex items-center gap-3">
      <label htmlFor="catalogue-sort" className="text-stone-700 dark:text-stone-300">
        {props.label}
      </label>
      <select
        id="catalogue-sort"
        name="sort"
        form={CATALOGUE_FORM_ID}
        defaultValue={props.value}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-stone-400 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-900"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckboxGroup(props: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  checked: readonly string[];
}) {
  return (
    <fieldset>
      <legend className="font-semibold">{props.legend}</legend>
      <ul className="mt-2 space-y-1.5">
        {props.options.map((option) => (
          <li key={option.value}>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name={props.name}
                value={option.value}
                defaultChecked={props.checked.includes(option.value)}
                className="size-4 accent-blue-600"
              />
              {option.label}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
