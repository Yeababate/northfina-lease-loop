'use client';

// One returned item in the returns console: where it stands, what blocks it, and the three
// steps (inspect, record the required work, relist). The stage, blockers and outstanding work
// come from deriveNextLife on the server; after every command the page is refreshed.
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { assetConditionSchema } from '@/data/schemas';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { Badge, primaryButton, secondaryButton, textLink } from '../ui';
import { Panel } from './panel';
import { ProblemMessage } from './problem-message';
import { ReturnMatches } from './return-matches';
import type { MatchesView, ReturnView } from './types';
import { useReturnAction } from './use-return-action';

type ReturnDetailProps = { locale: Locale; detail: ReturnView; matches: MatchesView | null };

const inputClass =
  'mt-1 rounded-lg border border-stone-400 bg-white px-2 py-1.5 dark:border-stone-600 dark:bg-stone-900';

export function ReturnDetail({ locale, detail, matches }: ReturnDetailProps) {
  const t = getT(locale);
  const action = useReturnAction(detail.id);
  const date = (iso: string | null) => (iso ? formatIsoDate(iso, locale) : '—');
  const usage = (value: number) =>
    t(`usage.${detail.asset.usage.unit}` as MessageKey, { value: formatNumber(value, locale) });
  const relisted = detail.stage === 'relisted';
  const revision = { expectedRevision: detail.revision };

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">
            {detail.asset.make} {detail.asset.model}
          </h2>
          <Badge tone={detail.canRelist || relisted ? 'green' : 'orange'}>
            {t(`returns.stage.${detail.stage}` as MessageKey)}
          </Badge>
          {detail.onHold ? <Badge tone="neutral">{t('returns.onHold')}</Badge> : null}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Fact label={t('returns.item')}>
            <Link
              href={`/${locale}/items/${encodeURIComponent(detail.asset.id)}`}
              className={textLink}
            >
              {detail.asset.id}
            </Link>
          </Fact>
          <Fact label={t('returns.previousLives')}>{detail.asset.previousLives}</Fact>
          <Fact label={t('returns.received')}>{date(detail.receivedOn)}</Fact>
          <Fact label={t('returns.now')}>
            {detail.current
              ? `${t(`condition.${detail.current.condition}` as MessageKey)} · ${usage(detail.current.usageValue)}`
              : '—'}
          </Fact>
          <Fact label={t('returns.lease')}>
            {detail.lease
              ? `${date(detail.lease.startOn)} – ${date(detail.lease.endOn)}`
              : t('returns.imported')}
          </Fact>
          {detail.relistedOn ? (
            <Fact label={t('returns.relistedOn')}>{date(detail.relistedOn)}</Fact>
          ) : null}
        </dl>
        <h3 className="mt-5 font-semibold">{t('returns.blockers')}</h3>
        {detail.blockers.length === 0 ? (
          <p className="mt-1 text-sm">
            {relisted ? t('returns.doneRelisted') : t('returns.noBlockers')}
          </p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {detail.blockers.map((blocker) => (
              <li key={blocker}>{t(`returns.blocker.${blocker}` as MessageKey)}</li>
            ))}
          </ul>
        )}
      </Panel>

      {relisted ? null : (
        <>
          <Panel title={t('returns.step.inspect')}>
            {detail.inspections.length > 0 ? (
              <p className="mb-3 text-sm">
                {t('returns.inspected', { count: detail.inspections.length })}
              </p>
            ) : null}
            <InspectionForm
              locale={locale}
              unit={detail.asset.usage.unit}
              busy={action.busy}
              onSubmit={(body) => action.send('inspection', { ...revision, ...body })}
            />
            <ProblemMessage locale={locale} problem={action.problem} steps={['inspection']} />
          </Panel>

          <Panel title={t('returns.step.work')}>
            {detail.required.length === 0 ? (
              <p className="text-sm">
                {detail.current ? t('returns.noWork') : t('returns.inspectFirst')}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {detail.required.map((required) => {
                  const open = detail.outstanding.includes(required.id);
                  return (
                    <li key={required.id} className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-xs">{required.id}</span>
                      {open ? (
                        <button
                          type="button"
                          className={secondaryButton}
                          disabled={action.busy}
                          onClick={() =>
                            void action.send('work', { ...revision, actionId: required.id })
                          }
                        >
                          {t('returns.markDone')}
                        </button>
                      ) : (
                        <Badge tone="green">{t('returns.workDone')}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <ProblemMessage locale={locale} problem={action.problem} steps={['work']} />
          </Panel>

          <Panel title={t('returns.step.relist')}>
            <button
              type="button"
              className={primaryButton}
              disabled={action.busy || !detail.canRelist}
              aria-describedby={detail.canRelist ? undefined : `relist-${detail.id}-why`}
              onClick={() => void action.send('relist', revision)}
            >
              {t('returns.relist')}
            </button>
            {detail.canRelist ? null : (
              <p
                id={`relist-${detail.id}-why`}
                className="mt-2 text-sm text-stone-700 dark:text-stone-300"
              >
                {t('returns.relistBlocked')}
              </p>
            )}
            <ProblemMessage locale={locale} problem={action.problem} steps={['relist']} />
          </Panel>

          {matches ? (
            <ReturnMatches locale={locale} matches={matches} action={action} />
          ) : detail.current ? null : (
            <Panel title={t('returns.matches.title')}>
              <p className="text-sm">{t('returns.matches.inspectFirst')}</p>
            </Panel>
          )}
        </>
      )}

      {relisted ? (
        <Panel>
          <p className="text-sm">
            {t('returns.leaseAgain')}{' '}
            <Link
              href={`/${locale}/items/${encodeURIComponent(detail.asset.id)}`}
              className={textLink}
            >
              {t('returns.openItem')}
            </Link>
          </p>
        </Panel>
      ) : null}

      {detail.history.length > 0 ? (
        <Panel title={t('returns.history')}>
          <ol className="space-y-1 text-sm">
            {detail.history.map((event, index) => (
              <li key={`${event.type}-${index}`}>
                <span className="tabular-nums">{date(event.on)}</span> ·{' '}
                <span className="font-mono text-xs">{event.type}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}

type InspectionBody = { condition: string; usageValue: number; hoursSinceService: number | null };

function InspectionForm(props: {
  locale: Locale;
  unit: string;
  busy: boolean;
  onSubmit: (body: InspectionBody) => Promise<boolean>;
}) {
  const t = getT(props.locale);
  const id = useId();
  const [condition, setCondition] = useState('fair');
  const [usageValue, setUsage] = useState('');
  const [hours, setHours] = useState('');
  const usageNumber = Number(usageValue);
  const usageValid = usageValue.trim() !== '' && Number.isInteger(usageNumber) && usageNumber >= 0;
  const hoursNumber = Number(hours);
  const hoursValid = hours.trim() === '' || (Number.isInteger(hoursNumber) && hoursNumber >= 0);

  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (!usageValid || !hoursValid) return;
        void props.onSubmit({
          condition,
          usageValue: usageNumber,
          hoursSinceService: hours.trim() === '' ? null : hoursNumber,
        });
      }}
    >
      <label className="flex flex-col">
        {t('condition.label')}
        <select
          className={inputClass}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        >
          {assetConditionSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(`condition.${value}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col">
        {t('returns.usage', { unit: props.unit })}
        <input
          className={inputClass}
          inputMode="numeric"
          required
          value={usageValue}
          aria-invalid={usageValue !== '' && !usageValid}
          aria-describedby={`${id}-usage-hint`}
          onChange={(e) => setUsage(e.target.value)}
        />
        <span id={`${id}-usage-hint`} className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          {t('returns.wholeNumber')}
        </span>
      </label>
      <label className="flex flex-col">
        {t('returns.hoursSinceService')}
        <input
          className={inputClass}
          inputMode="numeric"
          value={hours}
          aria-invalid={!hoursValid}
          onChange={(e) => setHours(e.target.value)}
        />
        <span className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          {t('returns.optional')}
        </span>
      </label>
      <button
        type="submit"
        className={primaryButton}
        disabled={props.busy || !usageValid || !hoursValid}
      >
        {t('returns.recordInspection')}
      </button>
    </form>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-stone-600 dark:text-stone-400">{label}</dt>
      <dd className="font-semibold break-words">{children}</dd>
    </div>
  );
}
