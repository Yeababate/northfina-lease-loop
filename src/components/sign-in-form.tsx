'use client';

// The demo name form (issue #1). A plain form posting to a server action, so it works
// without JavaScript too; with JavaScript, a problem shows next to the field without a reload.
import { useActionState, useId } from 'react';
import { signIn, type SignInState } from '@/app/[locale]/sign-in/actions';
import { DEMO_NAME_MAX_LENGTH } from '@/domain/demo-name';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { primaryButton } from './ui';

type SignInFormProps = { locale: Locale; next: string; currentName: string | null };

export function SignInForm({ locale, next, currentName }: SignInFormProps) {
  const t = getT(locale);
  const inputId = useId();
  const problemId = useId();
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {
    problem: null,
    name: currentName ?? '',
  });

  return (
    <form action={action} noValidate className="mt-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <label htmlFor={inputId} className="font-semibold">
        {t('signIn.label')}
      </label>
      <input
        id={inputId}
        name="name"
        type="text"
        autoComplete="name"
        defaultValue={state.name}
        maxLength={DEMO_NAME_MAX_LENGTH * 2}
        aria-invalid={state.problem ? true : undefined}
        aria-describedby={state.problem ? problemId : undefined}
        className="mt-2 w-full rounded-lg border border-stone-400 bg-white px-3 py-2.5 text-lg text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
      />
      {state.problem ? (
        <p id={problemId} role="alert" className="mt-2 font-medium text-red-700 dark:text-red-400">
          {t(`signIn.problem.${state.problem}`, { max: DEMO_NAME_MAX_LENGTH })}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${primaryButton} mt-4 w-full`}>
        {t('signIn.continue')}
      </button>
    </form>
  );
}
