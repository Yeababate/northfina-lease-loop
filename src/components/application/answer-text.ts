// Turns questions and answers from data/questions.json into text for one language.
// Question text comes from the data file; option labels come from our message files.
import type { Question } from '@/data/schemas';
import type { AnswerValue } from '@/domain/answer-check';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import { messages, type MessageKey, type Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

export function questionText(question: Question, locale: Locale): string {
  return question.text[locale];
}

/** "Why we ask" is required in English only, so other languages fall back to it. */
export function whyWeAsk(question: Question, locale: Locale): string {
  return question.why_we_ask[locale] ?? question.why_we_ask.en;
}

/** A choice option in words: "consumer" → "A private person". Unknown options stay as-is. */
export function optionLabel(option: string, t: Translate): string {
  const key = `option.${option}`;
  return key in messages.en ? t(key as MessageKey) : option;
}

/** An answer as the customer would say it, for "Your answers so far". */
export function answerText(
  question: Question,
  value: AnswerValue,
  locale: Locale,
  t: Translate
): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '–';
  if (typeof value === 'number') return formatEuro(value, intlLocale[locale]);
  if (question.type === 'choice') return optionLabel(value as string, t);
  if (question.type === 'date') return formatIsoDate(value as string, locale);
  return value as string;
}
