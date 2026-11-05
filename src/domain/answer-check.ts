// Checks one application answer against its question in data/questions.json.
// A problem is a value the UI shows next to the field, never an exception.
import type { Question } from '@/data/schemas';
import { checkBusinessId } from './business-id';
import { isIsoDate } from './iso-date';

/**
 * One answer, as the question type asks for it:
 * `choice`, `text`, `email`: a string; `date`: an ISO date string;
 * `money`: integer euro cents; `list`: an array of strings (may be empty).
 */
export type AnswerValue = string | number | readonly string[];

/** Answers by question id (`q_...`). */
export type Answers = Readonly<Record<string, AnswerValue>>;

export type AnswerProblem =
  | 'empty'
  | 'not_an_option'
  | 'bad_email'
  | 'bad_date'
  | 'bad_money'
  | 'bad_list'
  | 'bad_business_id_format'
  | 'bad_business_id_check_digit';

export type AnswerCheck = { ok: true } | { ok: false; problem: AnswerProblem };

/** Deliberately loose: something, an @, something, a dot, something. The real check is the email we send. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OK: AnswerCheck = { ok: true };
const problem = (p: AnswerProblem): AnswerCheck => ({ ok: false, problem: p });

/** Is `value` an acceptable answer to `question`? `undefined` means not answered. */
export function checkAnswer(question: Question, value: AnswerValue | undefined): AnswerCheck {
  if (value === undefined) return problem('empty');

  switch (question.type) {
    case 'choice':
      if (typeof value !== 'string' || value === '') return problem('empty');
      return question.options?.includes(value) ? OK : problem('not_an_option');

    case 'text': {
      if (typeof value !== 'string' || value.trim() === '') return problem('empty');
      if (question.validation?.format !== 'finnish_business_id') return OK;
      const id = checkBusinessId(value);
      if (id.ok) return OK;
      return problem(
        id.reason === 'bad_format' ? 'bad_business_id_format' : 'bad_business_id_check_digit'
      );
    }

    case 'email':
      if (typeof value !== 'string' || value.trim() === '') return problem('empty');
      return EMAIL.test(value.trim()) ? OK : problem('bad_email');

    case 'date':
      if (typeof value !== 'string' || value === '') return problem('empty');
      return isIsoDate(value) ? OK : problem('bad_date');

    case 'money':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? OK
        : problem('bad_money');

    case 'list':
      return Array.isArray(value) && value.every((item) => item.trim() !== '')
        ? OK
        : problem('bad_list');
  }
}
