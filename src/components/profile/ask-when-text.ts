// describeAskWhen's hints in words, for the profile questionnaire (#52): "Only asked for
// farm machines", "Only asked for leases from €10,000". The customer type is left out, as
// the questionnaire already shows only the questions of the chosen type.
import type { Question } from '@/data/schemas';
import { describeAskWhen, type AskWhenHint } from '@/domain/ask-when-hints';
import { formatEuro } from '@/domain/money';
import type { MessageKey, Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { optionLabel, questionText } from '../application/answer-text';

function range(
  t: Translate,
  keys: { from: MessageKey; upTo: MessageKey; between: MessageKey },
  from: string | undefined,
  upTo: string | undefined
): string {
  if (from !== undefined && upTo !== undefined) return t(keys.between, { from, to: upTo });
  if (from !== undefined) return t(keys.from, { from });
  return t(keys.upTo, { to: upTo ?? '' });
}

function hintText(
  hint: AskWhenHint,
  byId: ReadonlyMap<string, Question>,
  locale: Locale,
  t: Translate
): string | null {
  const intl = intlLocale[locale];
  const euro = (cents: number | undefined) =>
    cents === undefined ? undefined : formatEuro(cents, intl);
  const months = (value: number | undefined) =>
    value === undefined ? undefined : t('term.months', { months: value });
  switch (hint.kind) {
    case 'customer_type':
      return null;
    case 'category':
      return t('askWhen.category', {
        categories: hint.categories
          .map((category) =>
            category === 'e_bike' || category === 'laptop' || category === 'farm_machine'
              ? t(`category.${category}`).toLocaleLowerCase(intl)
              : category
          )
          .join(', '),
      });
    case 'amount':
      return range(
        t,
        {
          from: 'askWhen.amountFrom',
          upTo: 'askWhen.amountUpTo',
          between: 'askWhen.amountBetween',
        },
        euro(hint.fromCents),
        euro(hint.upToCents)
      );
    case 'term':
      return range(
        t,
        { from: 'askWhen.termFrom', upTo: 'askWhen.termUpTo', between: 'askWhen.termBetween' },
        months(hint.fromMonths),
        months(hint.upToMonths)
      );
    case 'answer': {
      const parent = byId.get(hint.questionId);
      if (!parent) return null;
      return t('askWhen.answer', {
        question: questionText(parent, locale),
        answer: hint.values.map((value) => optionLabel(value, t)).join(' / '),
      });
    }
  }
}

/** The hints for one question, in words; empty when it is asked of everyone of this type. */
export function askWhenText(
  question: Question,
  byId: ReadonlyMap<string, Question>,
  locale: Locale,
  t: Translate
): string[] {
  return describeAskWhen(question.ask_when).flatMap((hint) => {
    const text = hintText(hint, byId, locale, t);
    return text === null ? [] : [text];
  });
}
