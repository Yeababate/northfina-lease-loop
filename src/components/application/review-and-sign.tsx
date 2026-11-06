'use client';

// Review and sign (wireframe 5): the lease summary in the applicant's name and the signing
// panel. The application is checked here only to show the right message; the server checks
// it again when the contract is signed (src/server/contracts.ts → signApplication).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import type { CoefficientTable, Question } from '@/data/schemas';
import { checkApplicationForSigning, signingOfferKey } from '@/domain/application-signing';
import { formatEuro } from '@/domain/money';
import type { PriceSource } from '@/domain/price-list';
import type { Deal } from '@/domain/question-flow';
import { formatIsoDate } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { RememberedSetView } from '@/domain/remembered-answers';
import { Badge, InfoBox, primaryButton, secondaryButton } from '../ui';
import { RememberAnswers } from './remember-answers';
import { clearAnswers, useCanReadAnswers, useSavedAnswers } from './saved-answers';
import { useRememberedAnswers } from './use-remembered-answers';
import { priceBasis } from '@/domain/application-terms';
import { MonthlyPrice } from '../monthly-price';

export type LeaseSummary = {
  assetId: string;
  itemName: string;
  termMonths: number;
  downPaymentCents: number;
  startOn: string;
  monthlyNetCents: number;
  originalMonthlyNetCents: number;
  monthlyDiscountCents: number;
  discountBps: number;
  discountRuleId: string | null;
  discountRuleRevision: number | null;
  buyoutCents: number;
  priceListVersion: number;
  priceSource: PriceSource;
  listPriceCents: number;
  coefficientVersion: number;
  coefficientId: string;
  band: string;
  factor: number;
  financedCents: number;
};

type ReviewAndSignProps = {
  locale: Locale;
  lease: LeaseSummary;
  storageKey: string;
  questions: readonly Question[];
  deal: Deal;
  coefficientTable: CoefficientTable;
  monthlyRentWithVatCents: number;
  /** "Why this price?" and the VAT note, rendered on the server. */
  explanations: ReactNode;
  applyHref: string;
  quoteId?: string;
  /** The user's remembered answer sets (#52); null when signed out. */
  remembered: readonly RememberedSetView[] | null;
};

const SIGN_ERRORS = [
  'PRICE_CHANGED',
  'ASSET_UNAVAILABLE',
  'ASSET_ALREADY_OFFERED',
  'OFFER_CHANGED',
  'PLACEMENT_REQUIRED',
  'NOT_APPROVED',
  'SIGNATORY_REQUIRED',
  'LOGIN_REQUIRED',
  'QUOTE_NOT_FOUND',
  'QUOTE_MISMATCH',
];

export function ReviewAndSign(props: ReviewAndSignProps) {
  const { locale, lease } = props;
  const t = getT(locale);
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const router = useRouter();
  const agreeId = useId();
  const canRead = useCanReadAnswers();
  const answers = useSavedAnswers(props.storageKey);
  const store = useRememberedAnswers(props.remembered);
  // Consent belongs to the exact displayed offer, including buyout and VAT preview.
  const offerKey = signingOfferKey({
    ...lease,
    monthlyGrossCents: props.monthlyRentWithVatCents,
  });
  const [agreedOffer, setAgreedOffer] = useState<string | null>(null);
  const agreed = agreedOffer === offerKey;
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  const check = checkApplicationForSigning({
    questions: props.questions,
    deal: props.deal,
    answers,
    monthlyRentWithVatCents: props.monthlyRentWithVatCents,
    coefficientTable: props.coefficientTable,
  });

  // Card 6: the applicant may not sign for the company, so the contract is sent to the named
  // signatory instead. It is saved waiting for them; nothing is active until they sign.
  const sendToSignatory = !check.ok && check.reason === 'signatory_required';
  const signatoryEmail = !check.ok ? (check.signatoryEmail ?? '') : '';

  async function sign() {
    if (!agreed || busy || !canRead || !(check.ok || sendToSignatory)) return;
    if (errorKey === 'sign.error.PRICE_CHANGED') return;
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: lease.assetId,
          termMonths: lease.termMonths,
          downPaymentCents: lease.downPaymentCents,
          startOn: lease.startOn,
          ...(props.quoteId ? { quoteId: props.quoteId } : {}),
          locale,
          answers,
          expectedMonthlyNetCents: lease.monthlyNetCents,
          expectedBuyoutNetCents: lease.buyoutCents,
          expectedPriceListVersion: lease.priceListVersion,
          expectedPriceSource: lease.priceSource,
          expectedListPriceCents: lease.listPriceCents,
          expectedDiscountRuleId: lease.discountRuleId,
          expectedDiscountRuleRevision: lease.discountRuleRevision,
          expectedCoefficientVersion: lease.coefficientVersion,
          expectedCoefficientId: lease.coefficientId,
          expectedBand: lease.band,
          expectedFactor: lease.factor,
          expectedFinancedCents: lease.financedCents,
        }),
      });
      const result: { success: boolean; data?: { id: string }; error?: { code: string } } =
        await response.json();
      if (!result.success || !result.data) {
        const code = result.error?.code ?? '';
        if (code === 'PRICE_CHANGED') setAgreedOffer(null);
        setErrorKey(
          SIGN_ERRORS.includes(code) ? (`sign.error.${code}` as MessageKey) : 'sign.error.generic'
        );
        return;
      }
      clearAnswers(props.storageKey);
      router.push(`/${locale}/contracts/${result.data.id}`);
    } catch {
      setErrorKey('sign.error.generic');
    } finally {
      setBusy(false);
    }
  }

  const rows: { label: string; value: string; strong?: boolean }[] = [
    ...(check.ok ? [{ label: t('sign.leasedBy'), value: check.signerName }] : []),
    { label: t('sign.term'), value: t('term.months', { months: lease.termMonths }) },
    { label: t('sign.down'), value: euro(lease.downPaymentCents) },
    { label: t('discount.original'), value: euro(lease.originalMonthlyNetCents) },
    {
      label: t('discount.amount'),
      value: `−${euro(lease.monthlyDiscountCents)} (${lease.discountBps / 100}%)`,
    },
    { label: t('sign.monthlyNet'), value: euro(lease.monthlyNetCents), strong: true },
    { label: t('sign.buyout'), value: euro(lease.buyoutCents) },
    { label: t('sign.starts'), value: formatIsoDate(lease.startOn, locale) },
  ];

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">{t('sign.title')}</h1>
        <section
          aria-labelledby="lease-summary"
          className="mt-6 rounded-2xl border border-stone-300 p-6 dark:border-stone-700"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id="lease-summary" className="text-xl font-semibold">
              {lease.itemName}
            </h2>
            <Badge tone="blue">{t('sign.badgeLocked')}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-10 gap-y-2">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-stone-700 dark:text-stone-300">{row.label}</dt>
                <dd className={`tabular-nums ${row.strong ? 'font-semibold' : ''}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <MonthlyPrice
              netCents={lease.monthlyNetCents}
              grossCents={props.monthlyRentWithVatCents}
              basis={priceBasis(answers)}
              locale={locale}
            />
          </div>
        </section>
        <div className="mt-5 space-y-4">{props.explanations}</div>
      </div>

      <aside>
        <section
          aria-labelledby="sign-panel"
          className="rounded-2xl border border-stone-300 p-6 dark:border-stone-700"
        >
          <h2 id="sign-panel" className="text-xl font-semibold">
            {t('sign.panelTitle')}
          </h2>
          {!canRead ? (
            <p role="status">{t('sign.loadingApplication')}</p>
          ) : check.ok || sendToSignatory ? (
            <>
              <div className="mt-4 flex items-start gap-3">
                <input
                  id={agreeId}
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreedOffer(event.target.checked ? offerKey : null)}
                  className="mt-1 size-4 accent-blue-600"
                />
                <label htmlFor={agreeId}>{t('sign.agree')}</label>
              </div>
              <p role="status" className="mt-3 text-sm" id={`${agreeId}-status`}>
                {busy
                  ? t('sign.signing')
                  : !agreed
                    ? t('sign.confirmRequired')
                    : check.ok
                      ? t('sign.signingAs', { name: check.signerName })
                      : t('sign.sendingTo', { email: signatoryEmail })}
              </p>
              <button
                aria-describedby={`${agreeId}-status`}
                type="button"
                onClick={sign}
                disabled={!agreed || busy || errorKey === 'sign.error.PRICE_CHANGED'}
                className={`${primaryButton} mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {busy
                  ? t('sign.signing')
                  : check.ok
                    ? t('sign.button')
                    : t('sign.sendButton', { email: signatoryEmail })}
              </button>
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
                {check.ok
                  ? t('sign.signingAs', { name: check.signerName })
                  : t('sign.sendExplain', { email: signatoryEmail })}
              </p>
              {errorKey ? (
                <p role="alert" className="mt-3 font-medium text-red-700 dark:text-red-400">
                  {t(errorKey)}
                </p>
              ) : null}
            </>
          ) : (
            <div className="mt-4 space-y-4">
              <InfoBox>
                <p role="status">
                  {check.reason === 'signatory_required'
                    ? t('sign.signatoryOnly', { email: check.signatoryEmail ?? '' })
                    : check.reason === 'not_approved'
                      ? t('sign.notApproved')
                      : t('sign.noApplication')}
                </p>
              </InfoBox>
              {check.reason !== 'signatory_required' ? (
                <Link href={props.applyHref} className={secondaryButton}>
                  {t('sign.toApplication')}
                </Link>
              ) : null}
            </div>
          )}
        </section>
        {canRead && Object.keys(answers).length > 0 ? (
          <div className="mt-6">
            <RememberAnswers
              questions={props.questions}
              answers={answers}
              store={store}
              locale={locale}
              t={t}
            />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
