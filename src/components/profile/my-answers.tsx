'use client';

// Profile → My answers (#52). Choose the customer type first (and for a company its business
// id, which keys the set); the questionnaire then lists every question that could be asked
// of that type, with when it is asked and why. Answers are saved, changed and forgotten
// through #51's API; which questions show comes from src/domain/remembered-answers.ts.
import { useMemo, useState } from 'react';
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
import { useRememberedAnswers } from '../application/use-remembered-answers';
import { askWhenText } from './ask-when-text';
import { CustomerTypePicker } from './customer-type-picker';
import { FlagsBanner } from './flags-banner';
import { ForgetAllPanel } from './forget-all-panel';
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

  const key =
    type === 'company' ? parseProfileKey(`company:${businessId.trim()}`) : parseProfileKey(type);
  const idCheck =
    type === 'company' && businessId.trim() !== '' ? checkBusinessId(businessId) : null;
  const saved = savedAnswersOf(store.sets, key);
  const flags = store.sets.find((set) => set.profileKey === key?.key)?.flags ?? [];
  const shown = key ? profileQuestionnaire(questions, key, saved) : [];

  // One column on small screens; from lg a side column with the customer-type choice (and
  // "forget everything" below it) next to the questions in a two-column grid of cards.
  // DOM order stays choice → questions → forget all, so focus order matches reading order.
  return (
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-0">
      <div className="lg:col-start-1 lg:row-start-1">
        <CustomerTypePicker
          types={TYPES}
          type={type}
          onType={(option) => {
            setType(option);
            setEditingId(null);
          }}
          businessId={businessId}
          onBusinessId={(id) => {
            setBusinessId(id);
            setEditingId(null);
          }}
          onPickCompany={setBusinessId}
          idCheck={idCheck}
          companyIds={companyIds}
          t={t}
        />
        <p role="status" className="mt-4 text-sm">
          {store.busy ? t('remember.saving') : store.failed ? t('remember.failed') : ''}
        </p>
      </div>

      <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
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
            <h2 className="mt-8 text-xl font-semibold first:mt-0">{t('myAnswers.questions')}</h2>
            <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
              {t('myAnswers.questionsIntro')}
            </p>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
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
      </div>

      {store.sets.length > 0 ? (
        <div className="lg:col-start-1 lg:row-start-2">
          <ForgetAllPanel
            busy={store.busy}
            onForgetAll={store.forgetAll}
            onDone={() => setEditingId(null)}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}
