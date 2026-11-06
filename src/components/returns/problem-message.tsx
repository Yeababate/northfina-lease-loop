'use client';

// Why a returns-console command was refused, in plain words, with the server's code for support.
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import type { ActionProblem, ReturnStep } from './use-return-action';

export function ProblemMessage(props: {
  locale: Locale;
  problem: ActionProblem;
  steps: readonly ReturnStep[];
}) {
  const { locale, problem } = props;
  if (!problem || !props.steps.includes(problem.step)) return null;
  const t = getT(locale);
  const text =
    problem.code === 'REVISION_CHANGED' || problem.code === 'MATCH_CHANGED'
      ? t('returns.error.changed')
      : problem.code === 'NOT_READY'
        ? t('returns.error.notReady')
        : t('returns.error.generic');
  return (
    <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
      {text} <span className="font-mono text-xs">({problem.code})</span>
    </p>
  );
}
