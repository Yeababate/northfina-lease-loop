// "Its next life" on a returned item's page (scenario card 9): read-only, from the same
// refurbishment decision and waiting-list ranking the provider uses (src/server/waiting-list.ts).
// What work it gets and what that costs, its next-life price, who on the waiting list is
// offered it first, and, folded away, why the others are not.
import type { AssetCondition } from '@/data/schemas';
import { formatEuro } from '@/domain/money';
import type { MessageKey, Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { SecondLifeNote } from '@/server/waiting-list';
import { textLink } from './ui';

const WORK: Record<string, MessageKey> = {
  battery_replacement: 'nextLife.work.battery_replacement',
  safety_inspection: 'nextLife.work.safety_inspection',
  certified_data_wipe: 'nextLife.work.certified_data_wipe',
  major_service: 'nextLife.work.major_service',
};
const REASONS: Record<string, MessageKey> = {
  'lost:earlier_deadline': 'nextLife.why.earlier_deadline',
  'lost:less_refurbishment': 'nextLife.why.less_refurbishment',
  'lost:earlier_sign_up': 'nextLife.why.earlier_sign_up',
  'lost:entry_id': 'nextLife.why.entry_id',
  deadline_passed: 'nextLife.why.deadline_passed',
  not_ready_in_time: 'nextLife.why.not_ready_in_time',
  not_waiting: 'nextLife.why.not_waiting',
  condition_too_low: 'nextLife.why.condition_too_low',
  refurbishment_not_worth_it: 'nextLife.why.refurbishment_not_worth_it',
  unfinanceable: 'nextLife.why.unfinanceable',
  over_budget: 'nextLife.why.over_budget',
};

export function NextLifeNote({
  note,
  locale,
  t,
}: {
  note: SecondLifeNote;
  locale: Locale;
  t: Translate;
}) {
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const condition = (value: string) => t(`condition.${value as AssetCondition}`);
  const workLabel = (id: string) => {
    const upgrade = /^upgrade:(\w+)->(\w+)$/.exec(id);
    if (upgrade)
      return t('nextLife.work.upgrade', {
        from: condition(upgrade[1]!),
        to: condition(upgrade[2]!),
      });
    const key = WORK[id];
    return key ? t(key) : id;
  };

  return (
    <section
      aria-labelledby="next-life-title"
      className="rounded-xl border border-stone-300 px-5 py-4 text-sm dark:border-stone-700"
    >
      <h2 id="next-life-title" className="font-semibold">
        {t('nextLife.title')}
      </h2>

      {note.plan ? (
        <>
          <p className="mt-1 font-medium">
            {note.plan.toCondition === note.fromCondition
              ? t('nextLife.asIs', { condition: condition(note.fromCondition) })
              : t('nextLife.refurbished', {
                  from: condition(note.fromCondition),
                  to: condition(note.plan.toCondition),
                  cost: euro(note.plan.costCents),
                })}
          </p>
          <ul className="mt-1 text-stone-600 dark:text-stone-400">
            {note.plan.work.map((step) => (
              <li key={step.id} className="flex justify-between gap-4">
                <span>{workLabel(step.id)}</span>
                <span className="tabular-nums">{euro(step.costCents)}</span>
              </li>
            ))}
          </ul>
          {note.plan.priceCents !== null ? (
            <p className="mt-2 font-semibold">
              {t('nextLife.price', { price: euro(note.plan.priceCents) })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1">
          {note.recommendation.reason === 'incomplete_requirements'
            ? t('nextLife.incomplete')
            : note.recommendation.reason === 'not_worth_it_sell_or_scrap'
              ? t('nextLife.notWorthIt')
              : t('nextLife.noMatch')}
        </p>
      )}

      {note.winner ? (
        <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
          <p className="font-medium">
            {t('nextLife.offeredTo', { who: note.winner.who, id: note.winner.id })}
          </p>
          <p>
            {t('nextLife.terms', {
              months: note.winner.termMonths,
              rent: euro(note.winner.monthlyNetCents),
            })}
          </p>
        </div>
      ) : null}

      {note.others.length > 0 ? (
        <details className="mt-2">
          <summary className={`${textLink} cursor-pointer`}>{t('nextLife.whyNotOthers')}</summary>
          <ul className="mt-2 space-y-1">
            {note.others.map((other) => (
              <li key={other.id}>
                <span className="font-medium">
                  {other.who} ({other.id})
                </span>
                {': '}
                {REASONS[other.reason] ? t(REASONS[other.reason]!) : other.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-stone-600 dark:text-stone-400">{t('nextLife.rule')}</p>
        </details>
      ) : null}
    </section>
  );
}
