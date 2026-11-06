// What remembered answers mean for every lease (#52), from profileFlags() (#51): "Because you
// answered yes to …, every lease from €10,000 is checked by a person." Kind and plain, with
// a way to change the answer behind each one.
import type { Question } from '@/data/schemas';
import type { Answers } from '@/domain/answer-check';
import { formatEuro } from '@/domain/money';
import type { ProfileFlag } from '@/domain/profile-flags';
import { formatIsoDate } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { questionText } from '../application/answer-text';
import { textLink } from '../ui';

type FlagsBannerProps = {
  flags: readonly ProfileFlag[];
  answers: Answers;
  byId: ReadonlyMap<string, Question>;
  onChange: (questionId: string) => void;
  locale: Locale;
  t: Translate;
};

function flagText(flag: ProfileFlag, props: FlagsBannerProps): string {
  const { answers, byId, locale, t } = props;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const question = byId.get(flag.questionId);
  const asked = question ? questionText(question, locale) : '';
  switch (flag.id) {
    case 'pep_yes':
      return t('flags.pep_yes', { question: asked, amount: euro(flag.minFinancedCents) });
    case 'under_18':
      return t('flags.under_18', { date: formatIsoDate(flag.until, locale) });
    case 'country_not_supported':
      return t('flags.country_not_supported');
    case 'cannot_sign_for_company': {
      const email = answers.q_signatory_email;
      return typeof email === 'string'
        ? t('flags.cannot_sign', { email })
        : t('flags.cannot_sign_no_email');
    }
    case 'income_low':
      return t('flags.income_low', { amount: euro(flag.maxMonthlyRentWithVatCents) });
  }
}

export function FlagsBanner(props: FlagsBannerProps) {
  const { flags, byId, locale, t } = props;
  if (flags.length === 0) return null;
  return (
    <section
      aria-labelledby="profile-flags"
      className="mt-6 rounded-2xl bg-blue-50 px-5 py-4 text-stone-800 dark:bg-blue-950/60 dark:text-stone-200"
    >
      <h2 id="profile-flags" className="font-semibold">
        {t('flags.title')}
      </h2>
      <ul className="mt-2 space-y-3">
        {flags.map((flag) => {
          const question = byId.get(flag.questionId);
          return (
            <li key={flag.id}>
              <p>{flagText(flag, props)}</p>
              {question ? (
                <button
                  type="button"
                  onClick={() => props.onChange(flag.questionId)}
                  aria-label={t('apply.changeLabel', { question: questionText(question, locale) })}
                  className={`${textLink} text-sm`}
                >
                  {t('flags.change')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
