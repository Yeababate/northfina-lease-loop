// The application result: approved, not possible yet, or a person will check. Every
// outcome says why, and lists what we checked in words, not colours alone. The answers sit in
// the wizard's side bar beside it.
import Link from 'next/link';
import { ruleForBlock } from '@/domain/application-progress';
import type { Check, Decision } from '@/domain/eligibility';
import { formatEuro } from '@/domain/money';
import type { FlowState } from '@/domain/question-flow';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { Badge, InfoBox, primaryButton, secondaryButton } from '../ui';

type Outcome = Exclude<Decision, { outcome: 'incomplete' }>;

type DecisionViewProps = {
  decision: Outcome;
  flow: FlowState;
  monthlyRentWithVatCents: number;
  minFinancedCents: number;
  maxFinancedCents: number;
  links: { sign: string; changeLease: string; catalogue: string };
  locale: Locale;
  t: Translate;
};

const checkMark: Record<Check['result'], string> = {
  passed: '✓',
  failed: '✗',
  review: '?',
  not_checked: '–',
  not_applicable: '',
};

export function DecisionView(props: DecisionViewProps) {
  const { decision, flow, locale, t } = props;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const email = typeof flow.answers.q_email === 'string' ? flow.answers.q_email : '';

  function reasonText(check: Check): string {
    const rule = check.rule;
    switch (rule) {
      case 'affordability':
        return t('reason.affordability', {
          rent: euro(props.monthlyRentWithVatCents),
          max: euro(check.maxMonthlyRentWithVatCents ?? 0),
        });
      case 'financed_limits':
        return check.limit === 'above_maximum'
          ? t('reason.financed_above', { max: euro(props.maxFinancedCents) })
          : t('reason.financed_below', { min: euro(props.minFinancedCents) });
      case 'min_age':
      case 'residency':
      case 'business_id':
      case 'pep_manual_review':
        return t(`reason.${rule}`);
    }
  }

  // A blocking answer explains itself with the rule it broke, like any other decline.
  const blockRule = flow.block ? ruleForBlock(flow.block) : null;
  const reasons =
    decision.reasons.length > 0
      ? decision.reasons.map(reasonText)
      : decision.outcome === 'declined'
        ? [blockRule ? reasonText({ rule: blockRule, result: 'failed' }) : t('reason.other')]
        : [];
  const shownChecks = decision.checks.filter((check) => check.result !== 'not_applicable');

  return (
    <section aria-labelledby="decision-title" className="max-w-2xl">
      <p className="text-sm text-stone-600 dark:text-stone-400">{t('decision.title')}</p>
      <div className="mt-4 rounded-2xl border border-stone-300 p-6 dark:border-stone-700">
        <Badge tone={badgeTone[decision.outcome]}>{t(`decision.badge.${decision.outcome}`)}</Badge>
        <h1 id="decision-title" className="mt-3 text-3xl font-semibold tracking-tight">
          {decision.outcome === 'approved'
            ? t('decision.approved.title')
            : decision.outcome === 'declined'
              ? t('decision.declined.title')
              : t('decision.manual.title')}
        </h1>

        <div className="mt-3 space-y-2 text-stone-800 dark:text-stone-200">
          {decision.outcome === 'approved' ? (
            <>
              <p>{t('decision.approved.text')}</p>
              {decision.signatoryEmail ? (
                <p>{t('decision.approved.signatory', { email: decision.signatoryEmail })}</p>
              ) : null}
            </>
          ) : decision.outcome === 'declined' ? (
            <>
              {reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
              <p>{t('decision.declined.sorry')}</p>
            </>
          ) : (
            <p>{t('decision.manual.text', { email })}</p>
          )}
        </div>

        {decision.outcome === 'manual_review' && reasons.length > 0 ? (
          <div className="mt-4">
            <InfoBox title={t('decision.why')}>
              {reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </InfoBox>
          </div>
        ) : null}

        <div className="mt-4">
          <InfoBox title={t('decision.checked')}>
            <ul className="mt-1 space-y-1">
              {shownChecks.map((check) => (
                <li key={check.rule} className="flex gap-2">
                  <span aria-hidden="true" className="w-4 text-center">
                    {checkMark[check.result]}
                  </span>
                  <span>
                    {t(`rule.${check.rule}`)}:{' '}
                    <span className="font-medium">{t(`check.${checkResultKey(check)}`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </InfoBox>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {decision.outcome === 'approved' ? (
            <Link href={props.links.sign} className={primaryButton}>
              {t('decision.reviewAndSign')}
            </Link>
          ) : null}
          {decision.reasons.some((check) => check.rule === 'affordability') ? (
            <Link href={props.links.changeLease} className={secondaryButton}>
              {t('decision.changeLease')}
            </Link>
          ) : null}
          <Link href={props.links.catalogue} className={secondaryButton}>
            {t('decision.backToCatalogue')}
          </Link>
        </div>
      </div>
    </section>
  );
}

const badgeTone = { approved: 'green', declined: 'neutral', manual_review: 'orange' } as const;

function checkResultKey(check: Check): 'passed' | 'failed' | 'review' | 'not_checked' {
  return check.result === 'not_applicable' ? 'not_checked' : check.result;
}
