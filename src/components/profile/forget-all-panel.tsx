'use client';

// Profile → My answers (#52): forget every remembered answer, after a confirm step.
// Lives under the customer-type choice in the side column from lg.
import { useState } from 'react';
import type { Translate } from '@/i18n/get-t';
import { secondaryButton } from '../ui';

type ForgetAllPanelProps = {
  busy: boolean;
  /** Resolves true when everything was forgotten. */
  onForgetAll: () => Promise<boolean>;
  onDone: () => void;
  t: Translate;
};

export function ForgetAllPanel({ busy, onForgetAll, onDone, t }: ForgetAllPanelProps) {
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <section
      aria-labelledby="forget-all"
      className="mt-8 border-t border-stone-200 pt-6 dark:border-stone-800"
    >
      <h2 id="forget-all" className="text-lg font-semibold">
        {t('myAnswers.forgetAllTitle')}
      </h2>
      <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
        {t('myAnswers.forgetAllText')}
      </p>
      {confirmAll ? (
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label={t('myAnswers.forgetAllConfirm')}
        >
          <p className="w-full font-medium">{t('myAnswers.forgetAllConfirm')}</p>
          <button
            type="button"
            onClick={async () => {
              if (await onForgetAll()) setConfirmAll(false);
              onDone();
            }}
            disabled={busy}
            className={`${secondaryButton} border-red-700 text-red-800 dark:border-red-400 dark:text-red-300`}
          >
            {t('myAnswers.forgetAllYes')}
          </button>
          <button type="button" onClick={() => setConfirmAll(false)} className={secondaryButton}>
            {t('myAnswers.forgetAllNo')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmAll(true)}
          className={`${secondaryButton} mt-3`}
        >
          {t('myAnswers.forgetAll')}
        </button>
      )}
    </section>
  );
}
