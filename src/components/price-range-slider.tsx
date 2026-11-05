'use client';

// A two-handle price slider from €0 to €15,000+, built from two native range inputs laid on
// one track, so each handle keeps the browser's keyboard and screen-reader support.
//
// The inputs are named `min` and `max`, so the filter form submits them even without
// JavaScript. With JavaScript, the ends of the slider are left out of the URL (they mean
// "no limit"), and the form applies when a handle is let go, not on every pixel.
import { useEffect, useRef, useState } from 'react';
import {
  normalisePriceRange,
  PRICE_SLIDER_MAX_EUROS,
  PRICE_SLIDER_STEP_EUROS,
  priceFilterKind,
} from '@/domain/catalogue';
import { formatWholeEuros } from '@/domain/money';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

type PriceRangeSliderProps = {
  minEuros: number | null;
  maxEuros: number | null;
  locale: Locale;
  t: Translate;
};

const TOP = PRICE_SLIDER_MAX_EUROS;
const STEP = PRICE_SLIDER_STEP_EUROS;

export function PriceRangeSlider({ minEuros, maxEuros, locale, t }: PriceRangeSliderProps) {
  // Snap URL values onto the slider's steps; the URL itself is already normalised.
  const [low, setLow] = useState(() => snap(minEuros ?? 0));
  const [high, setHigh] = useState(() => snap(maxEuros ?? TOP));
  const lowRef = useRef<HTMLInputElement>(null);
  const highRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const inputs = [lowRef.current, highRef.current].filter(
      (input): input is HTMLInputElement => input !== null
    );
    const form = inputs[0]?.form;
    if (!form) return;

    // A native "change" fires once a handle is let go (or per arrow-key step).
    const apply = () => form.requestSubmit();
    // Leave "no limit" ends out of the URL: /en?max=15000 would only be noise.
    const tidy = (event: FormDataEvent) => {
      if (event.formData.get('min') === '0') event.formData.delete('min');
      if (Number(event.formData.get('max')) >= TOP) event.formData.delete('max');
    };
    inputs.forEach((input) => input.addEventListener('change', apply));
    form.addEventListener('formdata', tidy);
    return () => {
      inputs.forEach((input) => input.removeEventListener('change', apply));
      form.removeEventListener('formdata', tidy);
    };
  }, []);

  const euros = (value: number) => formatWholeEuros(value, intlLocale[locale]);
  const highText = (value: number) =>
    value >= TOP ? t('filters.priceNoLimit', { amount: euros(TOP) }) : euros(value);
  const range = normalisePriceRange(low, high);
  const summary = {
    any: () => t('filters.priceAny'),
    from: () => t('filters.priceFromOnly', { min: euros(low) }),
    up_to: () => t('filters.priceUpTo', { max: euros(high) }),
    between: () => t('filters.priceBetween', { min: euros(low), max: euros(high) }),
  }[priceFilterKind(range)]();

  // When both handles meet near the top, the low one must be on top to be draggable.
  const lowOnTop = low >= high - STEP && low > TOP / 2;

  return (
    <fieldset>
      <legend className="font-semibold">{t('filters.price')}</legend>
      <div className="relative mt-3 h-6">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-stone-300 dark:bg-stone-700"
        />
        <div
          aria-hidden="true"
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-600 dark:bg-blue-400"
          style={{ left: `${(low / TOP) * 100}%`, right: `${100 - (high / TOP) * 100}%` }}
        />
        <input
          ref={lowRef}
          type="range"
          name="min"
          min={0}
          max={TOP}
          step={STEP}
          value={low}
          aria-label={t('filters.priceMin')}
          aria-valuetext={euros(low)}
          onChange={(event) => setLow(Math.min(Number(event.target.value), high))}
          className={`dual-range ${lowOnTop ? 'z-20' : 'z-10'}`}
        />
        <input
          ref={highRef}
          type="range"
          name="max"
          min={0}
          max={TOP}
          step={STEP}
          value={high}
          aria-label={t('filters.priceMax')}
          aria-valuetext={highText(high)}
          onChange={(event) => setHigh(Math.max(Number(event.target.value), low))}
          className="dual-range z-10"
        />
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between text-sm text-stone-600">
        <span>{euros(0)}</span>
        <span>{highText(TOP)}</span>
      </div>
      <p aria-live="polite" className="mt-1 text-sm">
        {summary}
      </p>
    </fieldset>
  );
}

function snap(euros: number): number {
  return Math.min(TOP, Math.max(0, Math.round(euros / STEP) * STEP));
}
