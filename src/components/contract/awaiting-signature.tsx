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
import { formatEuro } from '@/domain/money';
import { intlLocale } from '@/i18n/locales';
import type { PriceLockNote } from '@/domain/application-signing';
import type { SignatoryOfferSnapshot } from '@/server/signatory';
import { primaryButton, secondaryButton } from '../ui';

type AwaitingSignatureProps = {
  contractId: string;
  locale: Locale;
  signatoryEmail: string;
  companyName: string;
  sentOn: string;
  today: string;
  startOn: string;
  /** Who is looking: the applicant who sent it, or the signatory who must sign. */
  viewer: 'applicant' | 'signatory';
  currentOffer?:
    | { snapshot: SignatoryOfferSnapshot; note: PriceLockNote; offerChanged: boolean }
    | { unavailable: true };
};

export function AwaitingSignature(props: AwaitingSignatureProps) {
  const { contractId, locale, signatoryEmail, companyName, viewer } = props;
  const t = getT(locale);
  const router = useRouter();
  const [dateDirty, setDateDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [consentedOffer, setConsentedOffer] = useState<string | null>(null);
  const [problemCode, setProblemCode] = useState<string | null>(null);
  const offer = props.currentOffer && 'snapshot' in props.currentOffer ? props.currentOffer : null;
  const offerKey = offer ? JSON.stringify(offer.snapshot) : '';
  const consented = offerKey !== '' && consentedOffer === offerKey;
  const path = `/${locale}/contracts/${encodeURIComponent(contractId)}`;

  async function sign() {
    setProblemCode(null);
    setBusy(true);
    try {
      if (!offer || !consented) return;
      const response = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected: offer.snapshot }),
      });
      if (response.ok) router.refresh();
      else {
        const result = await response.json();
        setProblemCode(result.error?.code ?? 'generic');
        if (result.error?.code === 'PRICE_CHANGED') setConsentedOffer(null);
      }
    } catch {
      setProblemCode('generic');
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
          <form method="get" className="mb-4 space-y-2">
            <p>{t('signatory.replaceStart')}</p>
            <label htmlFor="signatory-start">{t('signatory.startDate')}</label>
            <input
              id="signatory-start"
              name="startOn"
              type="date"
              required
              min={props.today}
              onChange={() => {
                setConsentedOffer(null);
                setDateDirty(true);
              }}
              defaultValue={props.startOn < props.today ? props.today : props.startOn}
              className="mx-2 rounded border p-2"
            />
            <button type="submit" className={secondaryButton}>
              {t('signatory.reviewDates')}
            </button>
          </form>
          {offer ? (
            <div className="mb-4 rounded-xl border border-stone-300 bg-white p-4 text-sm dark:border-stone-700 dark:bg-stone-900">
              <h3 className="font-semibold">{t('signatory.currentOffer')}</h3>
              <p>
                {t('signatory.startDate')}: {formatIsoDate(offer.snapshot.startOn, locale)}
              </p>
              <p className="mt-2">
                {t('discount.original')}:{' '}
                {formatEuro(offer.snapshot.originalMonthlyNetCents, intlLocale[locale])}
              </p>
              <p>
                {t('discount.amount')} ({offer.snapshot.discountBps / 100}%): −
                {formatEuro(offer.snapshot.monthlyDiscountCents, intlLocale[locale])}
              </p>
              <p className="font-semibold">
                {t('sign.monthlyNet')}:{' '}
                {formatEuro(offer.snapshot.monthlyNetCents, intlLocale[locale])}
              </p>
              <p>
                {t('lease.withVat', {
                  amount: formatEuro(offer.snapshot.monthlyGrossCents, intlLocale[locale]),
                  rate: offer.snapshot.vatPercent,
                })}
              </p>
              <p>
                {t('sign.buyout')}: {formatEuro(offer.snapshot.buyoutNetCents, intlLocale[locale])}
              </p>
              {offer.offerChanged ? (
                <p className="mt-2">
                  {t(
                    offer.note.direction === 'lower'
                      ? 'signatory.priceChangedLower'
                      : offer.note.direction === 'higher'
                        ? 'signatory.priceChangedHigher'
                        : 'signatory.priceChangedSame',
                    {
                      quoted: formatIsoDate(props.sentOn, locale),
                      difference: formatEuro(offer.note.differenceCents, intlLocale[locale]),
                    }
                  )}
                </p>
              ) : null}
              <div className="mt-4 flex items-start gap-3">
                <input
                  id="signatory-offer-consent"
                  type="checkbox"
                  checked={consented}
                  disabled={dateDirty}
                  onChange={(event) => setConsentedOffer(event.target.checked ? offerKey : null)}
                  className="mt-1 size-4 accent-blue-600"
                />
                <label htmlFor="signatory-offer-consent">{t('signatory.confirmCurrent')}</label>
              </div>
            </div>
          ) : (
            <p role="alert" className="mb-4 text-sm text-red-700 dark:text-red-400">
              {t('signatory.priceUnavailable')}
            </p>
          )}
          <button
            type="button"
            disabled={busy || dateDirty || !offer || !consented}
            onClick={sign}
            className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy ? t('sign.signing') : t('signatory.signButton', { company: companyName })}
          </button>
          {problemCode ? (
            <p role="alert" className="mt-2 font-medium text-red-700 dark:text-red-400">
              {problemCode === 'PRICE_CHANGED'
                ? t('signatory.stale')
                : problemCode === 'INVALID_PRICE'
                  ? t('signatory.priceUnavailable')
                  : t('signatory.problem')}
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
