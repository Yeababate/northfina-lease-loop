'use client';

// Profile → My answers (#52): "Answer as" (consumer, sole trader, company) and, for a
// company, its business id with the saved companies as quick picks. Sits in the side column
// from lg, so the radios stack and the input takes the column's width.
import { useId } from 'react';
import type { CustomerType } from '@/domain/answer-scope';
import type { BusinessIdResult } from '@/domain/business-id';
import type { Translate } from '@/i18n/get-t';
import { optionLabel } from '../application/answer-text';
import { secondaryButton } from '../ui';

type CustomerTypePickerProps = {
  types: readonly CustomerType[];
  type: CustomerType;
  onType: (type: CustomerType) => void;
  businessId: string;
  onBusinessId: (id: string) => void;
  /** A saved company chosen from the quick picks. */
  onPickCompany: (id: string) => void;
  idCheck: BusinessIdResult | null;
  companyIds: readonly string[];
  t: Translate;
};

export function CustomerTypePicker(props: CustomerTypePickerProps) {
  const { type, businessId, idCheck, companyIds, t } = props;
  const businessIdInput = useId();

  return (
    <>
      <fieldset>
        <legend className="text-xl font-semibold">{t('myAnswers.answerAs')}</legend>
        <div className="mt-3 flex flex-wrap gap-2 lg:flex-col">
          {props.types.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-4 py-2.5 has-checked:border-blue-600 has-checked:bg-blue-50 dark:border-stone-700 dark:has-checked:border-blue-400 dark:has-checked:bg-blue-950/60"
            >
              <input
                type="radio"
                name="profile-customer-type"
                value={option}
                checked={type === option}
                onChange={() => props.onType(option)}
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
            onChange={(event) => props.onBusinessId(event.target.value)}
            aria-describedby={`${businessIdInput}-note`}
            aria-invalid={idCheck && !idCheck.ok ? true : undefined}
            className="mt-1 block w-full max-w-xs rounded-lg border border-stone-400 bg-white px-3 py-2 lg:max-w-none dark:border-stone-600 dark:bg-stone-900"
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
                  onClick={() => props.onPickCompany(id)}
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
    </>
  );
}
