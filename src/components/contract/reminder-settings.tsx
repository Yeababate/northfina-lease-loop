'use client';

// Lease-end reminders on the contract page, kept simple: one on/off switch and a read-only
// list of when they go out. Saving sends the stored rules back unchanged with the new switch
// value; the server checks the revision and re-plans only future, unsent reminders.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ReminderPreferences } from '@/domain/reminder-preferences';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

export type ReminderSettingsView = {
  revision: number;
  preferences: ReminderPreferences;
  /** Planned sends; only `pending` ones are still to come. */
  schedule: { ruleId: string; localDate: string; localTime: string; status: string }[];
};

type ReminderSettingsProps = {
  contractId: string;
  locale: Locale;
  settings: ReminderSettingsView;
  /** The lease's last day (its exclusive end date minus one), so the dates have context. */
  lastDay: string;
};

export function ReminderSettings({ contractId, locale, settings, lastDay }: ReminderSettingsProps) {
  const t = getT(locale);
  const router = useRouter();
  const switchId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'stale' | 'error' | null>(null);
  const { preferences } = settings;
  const rules = preferences.rules
    .filter((rule) => rule.enabled)
    .toSorted((a, b) => b.daysBefore - a.daysBefore);

  async function toggle() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/reminders`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: settings.revision,
          preferences: { ...preferences, enabled: !preferences.enabled },
        }),
      });
      if (response.ok) router.refresh();
      else {
        setProblem(response.status === 409 ? 'stale' : 'error');
        if (response.status === 409) router.refresh();
      }
    } catch {
      setProblem('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
        <label htmlFor={switchId} className="font-semibold">
          {t('reminders.toggle')}
        </label>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={preferences.enabled}
          disabled={busy}
          onClick={toggle}
          className={
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ' +
            (preferences.enabled
              ? 'bg-blue-600 dark:bg-blue-500'
              : 'bg-stone-300 dark:bg-stone-600')
          }
        >
          <span
            aria-hidden="true"
            className={
              'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ' +
              (preferences.enabled ? 'translate-x-6' : 'translate-x-1')
            }
          />
        </button>
      </div>
      {problem ? (
        <p role="alert" className="font-medium text-red-700 dark:text-red-400">
          {t(`reminders.problem.${problem}`)}
        </p>
      ) : null}

      {preferences.enabled && rules.length > 0 ? (
        <div className="text-sm">
          <p>{t('reminders.endsOn', { date: formatIsoDate(lastDay, locale) })}</p>
          <p className="mt-0.5 text-stone-600 dark:text-stone-400">{t('reminders.willRemind')}</p>
          <ul className="mt-2 space-y-2">
            {rules.map((rule) => {
              const planned = settings.schedule.find(
                (row) => row.ruleId === rule.id && row.status === 'pending'
              );
              const channels = rule.channels
                .map((channel) => t(`reminders.channel.${channel}`))
                .join(t('reminders.and'));
              // The end date is exclusive, so "1 day before the end" is the lease's last day.
              const when =
                rule.daysBefore === 1
                  ? t('reminders.onLastDay')
                  : t('reminders.daysBeforeShort', { days: rule.daysBefore });
              return (
                <li key={rule.id}>
                  <p className="font-semibold">
                    {planned
                      ? t('reminders.dateTime', {
                          date: formatIsoDate(planned.localDate, locale),
                          time: planned.localTime,
                        })
                      : t('reminders.notPlanned')}
                  </p>
                  <p className="text-stone-600 dark:text-stone-400">
                    {when} · {channels}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-stone-600 dark:text-stone-400">{t('reminders.off')}</p>
      )}
    </div>
  );
}
