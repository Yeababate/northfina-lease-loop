// The input for one question, by its type: radio buttons, a text area, or a text, email or
// date field. Shared by the application (QuestionStep) and the profile page (#52), so an
// answer is typed the same way in both. It only holds text; toAnswer turns it into a value.
import type { Question } from '@/data/schemas';
import type { AnswerValue } from '@/domain/answer-check';
import { parseEuroInput } from '@/domain/money';
import type { Translate } from '@/i18n/get-t';
import { optionLabel } from './answer-text';

type AnswerFieldProps = {
  question: Question;
  /** The input's id. Choice questions use it to name their radio group. */
  inputId: string;
  /** The element that labels a choice question's radio group. */
  labelledBy: string;
  text: string;
  onText: (text: string) => void;
  describedBy?: string;
  invalid: boolean;
  t: Translate;
  /** Larger text in the application, smaller on the profile page. */
  size?: 'large' | 'normal';
};

const fieldClass = (size: 'large' | 'normal') =>
  `w-full max-w-sm rounded-lg border border-stone-400 bg-white px-3 py-2.5 text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 ${size === 'large' ? 'text-lg' : ''}`;

export function AnswerField(props: AnswerFieldProps) {
  const { question, inputId, text, onText, t, size = 'large' } = props;
  const describedBy = props.describedBy || undefined;

  if (question.type === 'choice') {
    return (
      <fieldset aria-labelledby={props.labelledBy} aria-describedby={describedBy}>
        <div className="grid max-w-md gap-2">
          {(question.options ?? []).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-300 px-4 py-3 has-checked:border-blue-600 has-checked:bg-blue-50 dark:border-stone-700 dark:has-checked:border-blue-400 dark:has-checked:bg-blue-950/60"
            >
              <input
                type="radio"
                name={`${inputId}-${question.id}`}
                value={option}
                checked={text === option}
                onChange={() => onText(option)}
                className="size-4 accent-blue-600"
              />
              {optionLabel(option, t)}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.type === 'list') {
    return (
      <textarea
        id={inputId}
        rows={4}
        value={text}
        onChange={(event) => onText(event.target.value)}
        aria-describedby={describedBy}
        aria-invalid={props.invalid ? true : undefined}
        className={fieldClass(size)}
      />
    );
  }
  return (
    <input
      id={inputId}
      type={inputType(question)}
      inputMode={question.type === 'money' ? 'decimal' : undefined}
      autoComplete={autoComplete(question)}
      value={text}
      onChange={(event) => onText(event.target.value)}
      aria-describedby={describedBy}
      aria-invalid={props.invalid ? true : undefined}
      className={fieldClass(size)}
    />
  );
}

/** The hint under a money or list field; other types explain themselves through problems. */
export function answerHint(question: Question, t: Translate): string | null {
  if (question.type === 'money') return t('apply.moneyHint');
  if (question.type === 'list') return t('apply.listHint');
  return null; // validation.hint in the data pack is English only, so problems explain instead
}

function inputType(question: Question): string {
  if (question.type === 'email') return 'email';
  if (question.type === 'date') return 'date';
  return 'text';
}

function autoComplete(question: Question): string | undefined {
  if (question.id === 'q_full_name') return 'name';
  if (question.id === 'q_birth_date') return 'bday';
  if (question.id === 'q_email') return 'email';
  return undefined;
}

/** A stored answer back into the text the input shows. */
export function toInputText(value: AnswerValue | undefined): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'number') {
    const euros = Math.floor(value / 100);
    const cents = value % 100;
    return cents === 0 ? String(euros) : `${euros}.${String(cents).padStart(2, '0')}`;
  }
  return value as string;
}

/** What the customer typed, as the answer type the question expects. */
export function toAnswer(question: Question, text: string): AnswerValue | undefined {
  if (question.type === 'list') {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (question.type === 'money') {
    const parsed = parseEuroInput(trimmed);
    // NaN is not whole cents, so checkAnswer reports it as bad_money.
    return parsed.ok ? parsed.cents : Number.NaN;
  }
  return trimmed;
}
