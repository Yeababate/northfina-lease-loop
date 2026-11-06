'use client';

// Profile → My answers (#52). Choose the customer type first (and for a company its business
// id, which keys the set); the questionnaire then lists every question that could be asked
// of that type, with when it is asked and why. Answers are saved, changed and forgotten
// through #51's API; which questions show comes from src/domain/remembered-answers.ts.
import { useId, useMemo, useState } from 'react';
import type { Question } from '@/data/schemas';
import type { CustomerType } from '@/domain/answer-scope';
import { parseProfileKey } from '@/domain/answer-scope';
import { checkBusinessId } from '@/domain/business-id';
import {
  profileQuestionnaire,
  savedAnswersOf,
  type RememberedSetView,
} from '@/domain/remembered-answers';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { optionLabel } from '../application/answer-text';
import { useRememberedAnswers } from '../application/use-remembered-answers';
import { secondaryButton } from '../ui';
import { askWhenText } from './ask-when-text';
import { FlagsBanner } from './flags-banner';
import { ProfileQuestion } from './profile-question';

type MyAnswersProps = {
  locale: Locale;
  questions: readonly Question[];
  initialSets: readonly RememberedSetView[];
};

const TYPES: readonly CustomerType[] = ['consumer', 'sole_trader', 'company'];

export function MyAnswers({ locale, questions, initialSets }: MyAnswersProps) {
  const t = getT(locale);
  const store = useRememberedAnswers(initialSets);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const companyIds = store.sets.flatMap((set) => {
    const key = parseProfileKey(set.profileKey);
    return key?.customerType === 'company' ? [key.businessId] : [];
  });

  // Start with the newest set, so a returning user sees what they saved last.
  const [type, setType] = useState<CustomerType>(
    () => parseProfileKey(initialSets[0]?.profileKey ?? '')?.customerType ?? 'consumer'
  );
  const [businessId, setBusinessId] = useState(() => companyIds[0] ?? '');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const businessIdInput = useId();

  const key =
    type === 'company' ? parseProfileKey(`company:${businessId.trim()}`) : parseProfileKey(type);
  const idCheck =
    type === 'company' && businessId.trim() !== '' ? checkBusinessId(businessId) : null;
  const saved = savedAnswersOf(store.sets, key);
  const flags = store.sets.find((set) => set.profileKey === key?.key)?.flags ?? [];
  const shown = key ? profileQuestionnaire(questions, key, saved) : [];

  return (
    <div className="mt-6">
      <fieldset>
        <legend className="text-xl font-semibold">{t('myAnswers.answerAs')}</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {TYPES.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-4 py-2.5 has-checked:border-blue-600 has-checked:bg-blue-50 dark:border-stone-700 dark:has-checked:border-blue-400 dark:has-checked:bg-blue-950/60"
            >
              <input
                type="radio"
                name="profile-customer-type"
                value={option}
                checked={type === option}
                onChange={() => {
                  setType(option);
                  setEditingId(null);
                }}
                className="size-4 accent-blue-600"
              />
              {optionLabel(option, t)}
            </label>
          ))}
        </div>
      </fieldset>

      {type === 'company' ? (
        <div className="mt-4">
          <label htmlFor={businessIdInput} className="font-medium">
            {t('myAnswers.businessId')}
          </label>
          <input
            id={businessIdInput}
            value={businessId}
            onChange={(event) => {
              setBusinessId(event.target.value);
              setEditingId(null);
            }}
            aria-describedby={`${businessIdInput}-note`}
            aria-invalid={idCheck && !idCheck.ok ? true : undefined}
            className="mt-1 block w-full max-w-xs rounded-lg border border-stone-400 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-900"
          />
          <p
            id={`${businessIdInput}-note`}
            className="mt-1 text-sm text-stone-600 dark:text-stone-400"
          >
            {idCheck && !idCheck.ok
              ? t(
                  `problem.bad_business_id_${idCheck.reason === 'bad_format' ? 'format' : 'check_digit'}`
                )
              : t('myAnswers.businessIdNote')}
          </p>
          {companyIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{t('myAnswers.savedCompanies')}</span>
              {companyIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBusinessId(id)}
                  aria-pressed={businessId.trim() === id}
                  className={`${secondaryButton} px-3 py-1 text-sm`}
                >
                  {id}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {key ? (
        <>
          <FlagsBanner
            flags={flags}
            answers={saved}
            byId={byId}
            onChange={setEditingId}
            locale={locale}
            t={t}
          />
          <h2 className="mt-8 text-xl font-semibold">{t('myAnswers.questions')}</h2>
          <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
            {t('myAnswers.questionsIntro')}
          </p>
          <ul className="mt-4 space-y-3">
            {shown.map((question) => (
              <ProfileQuestion
                key={`${key.key}:${question.id}`}
                question={question}
                saved={saved[question.id]}
                hints={askWhenText(question, byId, locale, t)}
                editing={editingId === question.id}
                busy={store.busy}
                onEdit={() => setEditingId(question.id)}
                onClose={() => setEditingId(null)}
                onSave={(value) => store.save(key.key, [[question.id, value]])}
                onForget={() => void store.forget(key.key, question.id)}
                locale={locale}
                t={t}
              />
            ))}
          </ul>
        </>
      ) : null}

      <p role="status" className="mt-4 text-sm">
        {store.busy ? t('remember.saving') : store.failed ? t('remember.failed') : ''}
      </p>

      {store.sets.length > 0 ? (
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
                  if (await store.forgetAll()) setConfirmAll(false);
                  setEditingId(null);
                }}
                disabled={store.busy}
                className={`${secondaryButton} border-red-700 text-red-800 dark:border-red-400 dark:text-red-300`}
              >
                {t('myAnswers.forgetAllYes')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className={secondaryButton}
              >
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
      ) : null}
    </div>
  );
}
