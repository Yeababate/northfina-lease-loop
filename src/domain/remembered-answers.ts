// Remembered answers inside an application and on the profile page (#52). #51 stores the
// sets and decides which answers may be remembered (answer-scope.ts); this module decides
// which set an application uses, how its answers pre-fill the questions, and which answers
// a "Remember" button would still save.
import type { Question } from '@/data/schemas';
import type { Answers, AnswerValue } from './answer-check';
import {
  couldApplyToProfile,
  impliedAnswers,
  isRememberable,
  parseProfileKey,
  type CustomerType,
  type ProfileKey,
} from './answer-scope';
import type { ProfileFlag } from './profile-flags';

/** One remembered set as the API lists it: the key and its stored answers. */
export type RememberedSet = {
  profileKey: string;
  answers: Readonly<Record<string, AnswerValue>>;
};

/** A remembered set with its sticky flags, as the pages hand it to the browser. */
export type RememberedSetView = RememberedSet & { flags: ProfileFlag[] };

/** The set an application or the profile page works with, with the implied answers added. */
export type ChosenSet = { key: ProfileKey; answers: Answers };

const CUSTOMER_TYPES: readonly CustomerType[] = ['consumer', 'sole_trader', 'company'];

function asCustomerType(value: AnswerValue | undefined): CustomerType | null {
  return typeof value === 'string' && (CUSTOMER_TYPES as readonly string[]).includes(value)
    ? (value as CustomerType)
    : null;
}

/**
 * The profile key that application answers belong to: the customer type, and for a company
 * its business id. `null` while the type is unknown, or for a company whose id is missing or
 * fails the check digit, because no set can be stored under such a key.
 */
export function profileKeyFromAnswers(answers: Answers): ProfileKey | null {
  const type = asCustomerType(answers.q_customer_type);
  if (type === null) return null;
  if (type !== 'company') return parseProfileKey(type);
  const businessId = answers.q_business_id;
  return typeof businessId === 'string' ? parseProfileKey(`company:${businessId}`) : null;
}

/**
 * Which remembered set pre-fills an application, given what has been answered so far.
 * Sets come most recently changed first, as the API lists them.
 * - No customer type yet: the newest set, so a returning customer starts where they left off.
 * - A person type: that type's set.
 * - A company: the set of the business id given, or while none is given the newest company
 *   set. A business id with no set means a company we know nothing about: no pre-fill.
 */
export function chooseProfileSet(
  sets: readonly RememberedSet[],
  answers: Answers
): ChosenSet | null {
  const parsed = sets.flatMap((set) => {
    const key = parseProfileKey(set.profileKey);
    return key ? [{ key, answers: set.answers }] : [];
  });
  const type = asCustomerType(answers.q_customer_type);
  const businessId = answers.q_business_id;
  const chosen =
    type === null
      ? parsed[0]
      : type !== 'company'
        ? parsed.find((set) => set.key.key === type)
        : typeof businessId === 'string'
          ? parsed.find((set) => set.key.key === `company:${businessId}`)
          : parsed.find((set) => set.key.customerType === 'company');
  if (!chosen) return null;
  return { key: chosen.key, answers: { ...chosen.answers, ...impliedAnswers(chosen.key) } };
}

/**
 * Application answers with the chosen set filled in underneath: anything answered in this
 * application wins over the profile. The question flow then drops what does not apply.
 */
export function prefillFromProfile(sets: readonly RememberedSet[], answers: Answers): Answers {
  const chosen = chooseProfileSet(sets, answers);
  return chosen ? { ...chosen.answers, ...answers } : answers;
}

/** Answers compared by value; a list must match in order, as it is stored. */
export function sameAnswer(a: AnswerValue | undefined, b: AnswerValue | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => item === b[index])
    );
  }
  return a === b;
}

/**
 * True when this question can get its own "Remember this answer" control. The customer type,
 * and a company's business id, are never saved on their own: they are the key of the set
 * (`impliedAnswers`), so they are remembered together with every other answer. Only the
 * customer type matters here, so this works before a company has given its business id.
 */
export function canRemember(questionId: string, customerType: CustomerType | null): boolean {
  if (!isRememberable(questionId) || questionId === 'q_customer_type') return false;
  return !(customerType === 'company' && questionId === 'q_business_id');
}

/** The customer type of application answers, if it is a known one. */
export function customerTypeOf(answers: Answers): CustomerType | null {
  return asCustomerType(answers.q_customer_type);
}

/**
 * `saved`: the set has this exact answer. `different`: it has another answer, which saving
 * would replace. `unsaved`: it has none. `not_rememberable`: about this deal only, or fixed
 * by the key itself (the customer type, a company's business id).
 */
export type RememberState = 'saved' | 'different' | 'unsaved' | 'not_rememberable';

export function rememberState(
  questionId: string,
  value: AnswerValue | undefined,
  key: ProfileKey | null,
  saved: Answers | undefined
): RememberState {
  if (key === null || !canRemember(questionId, key.customerType)) return 'not_rememberable';
  const current = saved?.[questionId];
  if (current === undefined) return 'unsaved';
  return sameAnswer(current, value) ? 'saved' : 'different';
}

/** The stored answers of the set with this key, without implied answers. */
export function savedAnswersOf(sets: readonly RememberedSet[], key: ProfileKey | null): Answers {
  if (key === null) return {};
  return sets.find((set) => set.profileKey === key.key)?.answers ?? {};
}

/**
 * What "Remember all my answers" saves: every given answer that can be remembered and is not
 * stored with this value yet, in question order. Order matters: a follow-up such as
 * `q_signatory_email` is kept only once its parent `q_can_sign` is stored, so parents go first.
 */
export function answersToRemember(
  questions: readonly Question[],
  answers: Answers,
  key: ProfileKey | null,
  saved: Answers
): [string, AnswerValue][] {
  if (key === null) return [];
  return questions.flatMap((question): [string, AnswerValue][] => {
    const value = answers[question.id];
    if (value === undefined) return [];
    const state = rememberState(question.id, value, key, saved);
    return state === 'unsaved' || state === 'different' ? [[question.id, value]] : [];
  });
}

/**
 * The questionnaire on the profile page for one key: every rememberable question that could
 * be asked of this customer type for some item, in question order. A follow-up appears only
 * once the answer it depends on is saved (PEP details after "yes"), as in the application.
 */
export function profileQuestionnaire(
  questions: readonly Question[],
  key: ProfileKey,
  saved: Answers
): Question[] {
  const known: Record<string, AnswerValue> = { ...impliedAnswers(key) };
  const shown: Question[] = [];
  for (const question of questions) {
    if (!couldApplyToProfile(question, known)) continue;
    const value = saved[question.id];
    if (value !== undefined) known[question.id] = value;
    if (canRemember(question.id, key.customerType)) shown.push(question);
  }
  return shown;
}
