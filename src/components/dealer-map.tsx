'use client';

// The nearby-dealer map (issue #73): an inline SVG outline of Finland with one pin per
// dealer, and the same dealers as a list, nearest first once a home town is chosen.
// Pins are real HTML buttons laid over the drawing, so they take keyboard focus and have
// accessible names; a pin and its list row share one selection. Only coarse positions
// (0.1°) and town names reach this component, never an address.
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import type { DealerLocation, HomeCity } from '@/data/schemas';
import {
  FINLAND_BOUNDS,
  FINLAND_OUTLINE,
  mapSize,
  outlinePath,
  projectToSvg,
} from '@/domain/finland-map';
import { nearestFirst } from '@/domain/geo';
import { getT, type Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { secondaryButton } from './ui';

type DealerMapProps = {
  locale: Locale;
  dealers: readonly DealerLocation[];
  cities: readonly HomeCity[];
};

const MAP_WIDTH = 300;
const SIZE = mapSize(FINLAND_BOUNDS, MAP_WIDTH);
const PATH = outlinePath(FINLAND_OUTLINE, FINLAND_BOUNDS, MAP_WIDTH);

/** Where a point sits over the drawing, in percent, so it scales with the SVG. */
function position(point: { lat: number; lon: number }) {
  const { x, y } = projectToSvg(point, FINLAND_BOUNDS, MAP_WIDTH);
  const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(2)}%`;
  return { left: percent(x, SIZE.width), top: percent(y, SIZE.height) };
}

type Row = DealerLocation & { shownDistanceKm: number | null };

function distanceText(t: Translate, km: number | null): string | null {
  if (km === null) return null;
  return km === 0 ? t('dealers.inYourArea') : t('dealers.distance', { km });
}

export function DealerMap({ locale, dealers, cities }: DealerMapProps) {
  const t = getT(locale);
  const id = useId();
  const [cityName, setCityName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const home = cities.find((city) => city.name === cityName) ?? null;

  // Without a home town the list keeps the data order and shows no distances.
  const rows: Row[] = useMemo(
    () =>
      home
        ? nearestFirst(home, dealers)
        : dealers.map((dealer) => ({ ...dealer, shownDistanceKm: null })),
    [home, dealers]
  );

  const toggle = (dealerId: string) =>
    setSelectedId((current) => (current === dealerId ? null : dealerId));

  return (
    <div className="space-y-6">
      <div className="max-w-sm">
        <label htmlFor={`${id}-city`} className="block font-medium">
          {t('dealers.home.label')}
        </label>
        <select
          id={`${id}-city`}
          aria-describedby={`${id}-city-hint`}
          value={cityName}
          onChange={(event) => setCityName(event.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-400 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-900"
        >
          <option value="">{t('dealers.home.placeholder')}</option>
          {cities.map((city) => (
            <option key={city.name} value={city.name}>
              {city.name}
            </option>
          ))}
        </select>
        <p id={`${id}-city-hint`} className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          {t('dealers.home.hint')}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_1fr]">
        <section aria-labelledby={`${id}-map`}>
          <h2 id={`${id}-map`} className="sr-only">
            {t('dealers.map.label', { count: dealers.length })}
          </h2>
          <div
            className="relative mx-auto w-full max-w-xs"
            style={{ aspectRatio: `${SIZE.width} / ${SIZE.height}` }}
          >
            <svg
              viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
              className="absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <path
                d={PATH}
                className="fill-stone-100 stroke-stone-500 dark:fill-stone-800 dark:stroke-stone-400"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            </svg>
            {home ? (
              <span
                role="img"
                aria-label={t('dealers.map.home', { city: home.name })}
                style={position(home)}
                className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-orange-600 ring-2 ring-white dark:bg-orange-400 dark:ring-stone-950"
              />
            ) : null}
            <ul aria-label={t('dealers.map.label', { count: dealers.length })}>
              {rows.map((dealer) => {
                const selected = dealer.id === selectedId;
                const distance = distanceText(t, dealer.shownDistanceKm);
                return (
                  <li key={dealer.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={
                        distance
                          ? t('dealers.pinWithDistance', {
                              name: dealer.name,
                              area: dealer.area,
                              distance,
                            })
                          : t('dealers.pin', { name: dealer.name, area: dealer.area })
                      }
                      onClick={() => toggle(dealer.id)}
                      style={position(dealer)}
                      className={
                        'absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ring-2 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ' +
                        (selected
                          ? 'z-10 scale-125 bg-blue-700 ring-white dark:bg-blue-400 dark:ring-stone-950'
                          : 'bg-white ring-blue-700 hover:scale-110 dark:bg-stone-900 dark:ring-blue-400')
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={
                          'size-2 rounded-full ' +
                          (selected ? 'bg-white dark:bg-stone-950' : 'bg-blue-700 dark:bg-blue-400')
                        }
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">{t('dealers.map.help')}</p>
        </section>

        <section aria-labelledby={`${id}-list`}>
          <h2 id={`${id}-list`} className="text-xl font-semibold">
            {home ? t('dealers.list.nearest') : t('dealers.list.all')}
          </h2>
          {home ? null : (
            <p className="mt-1 text-stone-700 dark:text-stone-300">
              {t('dealers.list.chooseHome')}
            </p>
          )}
          <ol className="mt-3 space-y-3">
            {rows.map((dealer) => {
              const selected = dealer.id === selectedId;
              const distance = distanceText(t, dealer.shownDistanceKm);
              return (
                <li
                  key={dealer.id}
                  className={
                    'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ' +
                    (selected
                      ? 'border-blue-700 bg-blue-50 dark:border-blue-400 dark:bg-blue-950'
                      : 'border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900')
                  }
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(dealer.id)}
                    className="rounded text-left"
                  >
                    <span className="block font-semibold">{dealer.name}</span>
                    <span className="block text-sm text-stone-700 dark:text-stone-300">
                      {dealer.area}
                      {distance ? ` · ${distance}` : ''}
                      {selected ? ` · ${t('dealers.selected')}` : ''}
                    </span>
                  </button>
                  <Link
                    href={`/${locale}?${new URLSearchParams({ provider: dealer.provider_id })}`}
                    aria-label={t('dealers.seeItemsOf', { name: dealer.name })}
                    className={`${secondaryButton} shrink-0 text-sm`}
                  >
                    {t('dealers.seeItems')}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}
