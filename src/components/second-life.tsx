// "Its second life" and the item passport on the item page (cards 9 and 10). Plain words for
// a customer: what was done to the item and what it cost, why, its new price, who on the
// waiting list it was offered to first and why, and the item's history across lives.
// Server components; the details fold out with <details>.
import type { AssetCondition } from '@/data/schemas';
import type { Passport, PassportEntry } from '@/domain/item-passport';
import { formatEuro } from '@/domain/money';
import type { NextLifeOption, NextLifePlan, PlannedAction } from '@/domain/second-life';
import { formatIsoDate } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { textLink } from './ui';

type Common = { locale: Locale; t: Translate };
const card = 'rounded-xl border border-stone-300 px-5 py-4 text-sm dark:border-stone-700';
const summaryLink = `${textLink} cursor-pointer`;

type SecondLifeProps = Common & {
  plan: NextLifePlan;
  /** Set once the plan has been carried out. */
  relistedOn: string | null;
  /** What it cost new (the data pack's first list price), for comparison. */
  originalPriceCents: number | null;
};

export function SecondLifePanel({
  plan,
  relistedOn,
  originalPriceCents,
  locale,
  t,
}: SecondLifeProps) {
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const condition = (value: AssetCondition) => t(`condition.${value}`);

  if (!plan.ok) {
    return (
      <section aria-labelledby="second-life-title" className={card}>
        <h2 id="second-life-title" className="font-semibold">
          {t('secondLife.title')}
        </h2>
        <p className="mt-1">
          {plan.reason === 'too_cheap_to_lease'
            ? t('secondLife.notOk.too_cheap_to_lease', {
                price: euro(plan.priceCents),
                min: euro(plan.minimumCents),
              })
            : t(`secondLife.notOk.${plan.reason}`)}
        </p>
      </section>
    );
  }

  const { chosen, alternative } = plan;
  const headline =
    chosen.kind === 'refurbished'
      ? t('secondLife.refurbished', {
          from: condition(alternative?.conditionAfter ?? chosen.conditionAfter),
          to: condition(chosen.conditionAfter),
        })
      : alternative
        ? t('secondLife.asIs', { condition: condition(chosen.conditionAfter) })
        : t('secondLife.serviced', { condition: condition(chosen.conditionAfter) });

  return (
    <section aria-labelledby="second-life-title" className={card}>
      <h2 id="second-life-title" className="font-semibold">
        {t('secondLife.title')}
      </h2>
      <p className="mt-1 font-medium">{headline}</p>

      <p className="mt-3 text-stone-600 dark:text-stone-400">
        {relistedOn ? t('secondLife.workDone') : t('secondLife.workPlanned')}
      </p>
      <ul className="mt-1 space-y-0.5">
        {chosen.actions.map((action) => (
          <li key={action.id} className="flex justify-between gap-4">
            <span>{actionLabel(action, t)}</span>
            <span className="tabular-nums">{euro(action.costCents)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-4 border-t border-stone-200 pt-0.5 font-semibold dark:border-stone-800">
          <span>{t('secondLife.total')}</span>
          <span className="tabular-nums">{euro(chosen.costCents)}</span>
        </li>
      </ul>
      <p className="mt-2">{why(chosen, alternative, euro, t)}</p>

      <p className="mt-3 font-semibold">
        {t('secondLife.price', { price: euro(chosen.priceCents) })}
      </p>
      {originalPriceCents !== null ? (
        <p className="text-stone-600 dark:text-stone-400">
          {t('secondLife.priceWhy', { original: euro(originalPriceCents) })}
        </p>
      ) : null}

      <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
        {chosen.match ? (
          <>
            <p className="font-medium">
              {t('secondLife.match', { who: chosen.match.who, id: chosen.match.requestId })}
            </p>
            <p>
              {t('secondLife.matchTerms', {
                months: chosen.match.termMonths,
                rent: euro(chosen.match.monthlyNetCents),
                date: formatIsoDate(chosen.match.neededBy, locale),
              })}
            </p>
          </>
        ) : (
          <p>{t('secondLife.noMatch')}</p>
        )}
        {chosen.notChosen.length > 0 ? (
          <details className="mt-2">
            <summary className={summaryLink}>{t('secondLife.others')}</summary>
            <ul className="mt-2 space-y-1">
              {chosen.notChosen.map((entry) => (
                <li key={entry.requestId}>
                  <span className="font-medium">
                    {entry.who} ({entry.requestId})
                  </span>
                  {': '}
                  {entry.reason === 'lost_tie_break'
                    ? t(`secondLife.why.tie.${entry.rule}`)
                    : entry.reason === 'over_budget'
                      ? t('secondLife.why.over_budget', { rent: euro(entry.monthlyNetCents) })
                      : t(`secondLife.why.${entry.reason}`)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-stone-600 dark:text-stone-400">{t('secondLife.tieRule')}</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function actionLabel(action: PlannedAction, t: Translate): string {
  const upgrade = /^upgrade:(\w+)->(\w+)$/.exec(action.id);
  if (upgrade)
    return t('secondLife.action.upgrade', {
      from: t(`condition.${upgrade[1] as AssetCondition}`),
      to: t(`condition.${upgrade[2] as AssetCondition}`),
    });
  const known = [
    'battery_replacement',
    'safety_inspection',
    'certified_data_wipe',
    'major_service',
  ] as const;
  const id = known.find((candidate) => candidate === action.id);
  return id ? t(`secondLife.action.${id}`) : action.id;
}

function why(
  chosen: NextLifeOption,
  alternative: NextLifeOption | null,
  euro: (cents: number) => string,
  t: Translate
): string {
  if (!chosen.match) return t('secondLife.whyNoMatch');
  if (!alternative || alternative.valueCents === null) return t('secondLife.whyOnly');
  return t(chosen.kind === 'refurbished' ? 'secondLife.whyRefurbish' : 'secondLife.whyAsIs', {
    chosen: euro(chosen.valueCents ?? 0),
    other: euro(alternative.valueCents),
  });
}

export function ItemPassport({ passport, locale, t }: Common & { passport: Passport }) {
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (iso: string) => formatIsoDate(iso, locale);
  return (
    <section aria-labelledby="passport-title" className={card}>
      <details>
        <summary className="cursor-pointer">
          <span id="passport-title" className="font-semibold">
            {t('passport.title')}
          </span>{' '}
          <span className="text-stone-600 dark:text-stone-400">
            · {t('passport.life', { n: passport.lifeNumber })}
          </span>
        </summary>
        <ol className="mt-3 space-y-1.5">
          {passport.entries.map((entry, index) => (
            <li key={index} className="flex gap-3">
              <span className="w-28 shrink-0 text-stone-600 tabular-nums dark:text-stone-400">
                {'on' in entry ? date(entry.on) : entry.kind === 'made' ? String(entry.year) : ''}
              </span>
              <span>{entryText(entry, euro, t)}</span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function entryText(entry: PassportEntry, euro: (cents: number) => string, t: Translate): string {
  switch (entry.kind) {
    case 'made':
      return t('passport.made');
    case 'earlier_lives':
      return t(entry.count === 1 ? 'passport.earlierOne' : 'passport.earlier', {
        count: entry.count,
      });
    case 'leased':
      return t('passport.leased', { months: entry.termMonths });
    case 'returned':
      return t('passport.returned');
    case 'inspected':
      return entry.condition
        ? t('passport.inspected', {
            condition: t(`condition.${entry.condition as AssetCondition}`),
          })
        : t('passport.inspectedPlain');
    case 'work':
      return actionLabel({ id: entry.actionId, kind: 'fixed', costCents: 0 }, t);
    case 'relisted':
      return entry.priceCents === null
        ? t('passport.relistedPlain')
        : t('passport.relisted', { price: euro(entry.priceCents) });
  }
}
