'use client';

// The filter sidebar. It is a plain GET form, so it works without JavaScript (press
// "Show items"); with JavaScript, ticking a box or picking from a list applies at once.
import Form from 'next/form';
import Link from 'next/link';
import type { FormEvent } from 'react';
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import type { CatalogueQuery, CatalogueSort } from '@/domain/catalogue';
import type { MessageKey } from '@/i18n/get-t';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { secondaryButton, textLink } from './ui';

export const CATALOGUE_FORM_ID = 'catalogue-filters';

type CatalogueFiltersProps = {
  locale: Locale;
  query: CatalogueQuery;
  categories: readonly AssetCategory[];
  conditions: readonly AssetCondition[];
  terms: readonly number[];
  today: string;
};

const fieldClass =
  'w-full rounded-lg border border-stone-400 bg-white px-3 py-2 text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100';

export function CatalogueFilters(props: CatalogueFiltersProps) {
  const { locale, query, categories, conditions, terms, today } = props;
  const t = getT(locale);

  // Free-text fields wait for Enter or the button; choices apply as soon as they change.
  function applyChoice(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement;
    if (target.type === 'text' || target.type === 'number' || target.type === 'search') return;
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

      <fieldset>
        <legend className="font-semibold">{t('filters.price')}</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <PriceField name="min" label={t('filters.priceFrom')} value={query.minPriceEuros} />
          <PriceField name="max" label={t('filters.priceTo')} value={query.maxPriceEuros} />
        </div>
      </fieldset>

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

function PriceField({ name, label, value }: { name: string; label: string; value: number | null }) {
  const id = `filter-${name}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <div className="relative mt-1">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-3 flex items-center text-stone-500"
        >
          €
        </span>
        <input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          defaultValue={value ?? ''}
          className={`${fieldClass} pl-7`}
        />
      </div>
    </div>
  );
}
