'use client';

// The waiting-list matches for an inspected return (card 9): the refurbishment decision, who
// on the waiting list gets the item and at what rent, and why the others do not. The ranking
// and every amount come from getWaitingListMatches on the server; this panel only shows them.
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { Badge, secondaryButton } from '../ui';
import { ProblemMessage } from './problem-message';
import { Panel } from './panel';
import type { MatchesView } from './types';
import type { useReturnAction } from './use-return-action';

type ReturnMatchesProps = {
  locale: Locale;
  matches: MatchesView;
  action: ReturnType<typeof useReturnAction>;
};

export function ReturnMatches({ locale, matches, action }: ReturnMatchesProps) {
  const t = getT(locale);
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const { decision } = matches;
  const recommended = decision.recommendation.optionId;

  return (
    <Panel title={t('returns.matches.title')}>
      <p className="text-sm">
        {recommended
          ? t('returns.matches.recommend', {
              option: t(`returns.option.${recommended}` as MessageKey),
            })
          : t(`returns.recommendation.${decision.recommendation.reason}` as MessageKey)}{' '}
        {t('returns.matches.readyOn', { date: formatIsoDate(matches.readyOn, locale) })}
      </p>

      <ul className="mt-3 space-y-1 text-sm">
        {decision.options.map((option) => (
          <li key={option.id}>
            <span className="font-medium">{t(`returns.option.${option.id}` as MessageKey)}</span>
            {': '}
            {t('returns.matches.optionCost', { cost: euro(option.costCents) })}
            {option.work.length > 0
              ? ` (${option.work.map((w) => `${w.action.id} ${euro(w.costCents)}`).join(', ')})`
              : ''}
            {option.id === recommended ? (
              <>
                {' '}
                <Badge tone="green">{t('returns.matches.recommended')}</Badge>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 className="mt-5 font-semibold">{t('returns.matches.ranked')}</h3>
      {matches.reserved ? (
        <p className="mt-1 text-sm">{t('returns.matches.reserved')}</p>
      ) : !matches.canAssign ? (
        <p className="mt-1 text-sm">{t('returns.matches.cannotAssign')}</p>
      ) : null}
      {matches.ranked.length === 0 ? (
        <p className="mt-1 text-sm">{t('returns.matches.none')}</p>
      ) : (
        <ol className="mt-2 space-y-3 text-sm">
          {matches.ranked.map((offer, index) => (
            <li
              key={offer.entry.id}
              className="rounded-xl border border-stone-300 p-3 dark:border-stone-700"
            >
              <p className="font-semibold">
                {index + 1}. {offer.entry.id} · {offer.entry.who}
              </p>
              <p>
                {t('returns.matches.rent', {
                  net: euro(offer.monthlyNetCents),
                  gross: euro(offer.monthlyGrossCents),
                  months: offer.entry.preferred_term_months,
                })}
              </p>
              <p className="text-stone-700 dark:text-stone-300">
                {t(`returns.option.${offer.option.id}` as MessageKey)} ·{' '}
                {t(`returns.rank.${offer.rankReason}` as MessageKey)}
              </p>
              <button
                type="button"
                className={`${secondaryButton} mt-2`}
                disabled={action.busy || !matches.canAssign}
                onClick={() => void action.send('assign', { entryId: offer.entry.id })}
              >
                {t('returns.matches.assign', { entry: offer.entry.id })}
              </button>
            </li>
          ))}
        </ol>
      )}
      <ProblemMessage locale={locale} problem={action.problem} steps={['assign']} />

      {matches.rejected.length > 0 ? (
        <>
          <h3 className="mt-5 font-semibold">{t('returns.matches.rejected')}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {matches.rejected.map((row) => (
              <li key={row.entryId}>
                {row.entryId}: {t(`returns.reject.${row.reason}` as MessageKey)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}
