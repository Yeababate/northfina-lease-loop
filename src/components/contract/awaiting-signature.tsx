'use client';

// Card 6 on the contract page: the lease is saved but waits for the company's signatory.
// The applicant sees who it was sent to and what happens next, with a link to pass on; the
// signatory (signed in with that email) sees a button to sign. Nothing is active or billed
// until they do.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { primaryButton, secondaryButton } from '../ui';

type AwaitingSignatureProps = {
  contractId: string;
  locale: Locale;
  signatoryEmail: string;
  companyName: string;
  sentOn: string;
  /** Who is looking: the applicant who sent it, or the signatory who must sign. */
  viewer: 'applicant' | 'signatory';
};

export function AwaitingSignature(props: AwaitingSignatureProps) {
  const { contractId, locale, signatoryEmail, companyName, viewer } = props;
  const t = getT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const [copied, setCopied] = useState(false);
  const path = `/${locale}/contracts/${encodeURIComponent(contractId)}`;

  async function sign() {
    setBusy(true);
    setProblem(false);
    try {
      const response = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/signature`, {
        method: 'POST',
      });
      if (response.ok) router.refresh();
      else setProblem(true);
    } catch {
      setProblem(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-labelledby="awaiting-title"
      className="rounded-2xl border border-orange-300 bg-orange-50 p-6 dark:border-orange-800 dark:bg-orange-950/40"
    >
      <h2 id="awaiting-title" className="text-xl font-semibold">
        {viewer === 'signatory'
          ? t('signatory.titleSignatory', { company: companyName })
          : t('signatory.titleApplicant', { email: signatoryEmail })}
      </h2>
      <p className="mt-2">
        {viewer === 'signatory'
          ? t('signatory.bodySignatory', { company: companyName })
          : t('signatory.bodyApplicant', {
              email: signatoryEmail,
              date: formatIsoDate(props.sentOn, locale),
            })}
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>{t('signatory.step1', { email: signatoryEmail })}</li>
        <li>{t('signatory.step2')}</li>
        <li>{t('signatory.step3')}</li>
      </ol>
      {viewer === 'signatory' ? (
        <div className="mt-4">
          <button type="button" disabled={busy} onClick={sign} className={primaryButton}>
            {busy ? t('sign.signing') : t('signatory.signButton', { company: companyName })}
          </button>
          {problem ? (
            <p role="alert" className="mt-2 font-medium text-red-700 dark:text-red-400">
              {t('signatory.problem')}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={copyLink} className={secondaryButton}>
            {t('signatory.copyLink')}
          </button>
          <span role="status" className="text-sm text-stone-700 dark:text-stone-300">
            {copied ? t('signatory.copied') : ''}
          </span>
        </div>
      )}
    </section>
  );
}
