// "Can I lease this straight away?" for one item, from the readiness API (#51, #52). Plain
// markup with no state, so the catalogue renders it on the server and the item page in the
// browser. Every badge says its meaning in words and with a symbol, never by colour alone,
// and the reasons for a review or a "not available" sit in a details element under it.
import Link from 'next/link';
import type { Readiness } from '@/domain/lease-readiness';
import { formatEuro } from '@/domain/money';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { Badge, textLink, type BadgeTone } from './ui';

export type ReadinessView = Pick<
  Readiness,
  'status' | 'reasons' | 'missing' | 'dealQuestionIds' | 'maxMonthlyRentWithVatCents'
>;

type ReadinessBadgeProps = {
  /** Nothing is shown for an unknown item (`not_found`) or when there is no answer. */
  readiness: ReadinessView | { status: 'not_found' } | undefined;
  locale: Locale;
  t: Translate;
  /** Where to answer missing questions ahead of time: the profile page. */
  profileHref?: string;
};

const look: Record<
  Exclude<Readiness['status'], 'not_leasable'>,
  { tone: BadgeTone; mark: string }
> = {
  ready: { tone: 'green', mark: '✓' },
  missing: { tone: 'blue', mark: '…' },
  manual_review: { tone: 'orange', mark: '?' },
  // Kind, not alarming (scenario card 5): no red, and the reason is explained.
  declined: { tone: 'neutral', mark: '–' },
};

/** The badge's words. `ready` still counts the questions about this one lease. */
export function readinessText(readiness: ReadinessView, t: Translate): string {
  const dealCount = readiness.dealQuestionIds.length;
  switch (readiness.status) {
    case 'ready':
      return dealCount === 0
        ? t('readiness.ready')
        : t(dealCount === 1 ? 'readiness.readyOneDeal' : 'readiness.readyDeal', {
            count: dealCount,
          });
    case 'missing': {
      // Everything still to answer: the profile questions and the ones about this lease.
      const count = readiness.missing.count + dealCount;
      return t(count === 1 ? 'readiness.missingOne' : 'readiness.missing', { count });
    }
    case 'manual_review':
      return t('readiness.manualReview');
    case 'declined':
      return t('readiness.declined');
    case 'not_leasable':
      return '';
  }
}

/**
 * `not_leasable` renders nothing: the card and the item page already show the item's own
 * unavailable message (reserved, being refurbished, or no price for this lease).
 */
export function ReadinessBadge({ readiness, locale, t, profileHref }: ReadinessBadgeProps) {
  if (!readiness || readiness.status === 'not_found' || readiness.status === 'not_leasable') {
    return null;
  }
  const { tone, mark } = look[readiness.status];
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const reasons =
    readiness.status === 'declined' || readiness.status === 'manual_review'
      ? readiness.reasons.map((rule) =>
          rule === 'affordability'
            ? t('readiness.reason.affordability', {
                max: euro(readiness.maxMonthlyRentWithVatCents ?? 0),
              })
            : t(`readiness.reason.${rule}`)
        )
      : [];

  return (
    <div className="text-sm">
      <Badge tone={tone}>
        <span aria-hidden="true" className="mr-1">
          {mark}
        </span>
        {readinessText(readiness, t)}
      </Badge>
      {reasons.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-stone-700 underline underline-offset-2 dark:text-stone-300">
            {t('readiness.why')}
          </summary>
          <div className="mt-1 space-y-1 text-stone-700 dark:text-stone-300">
            {reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </div>
        </details>
      ) : null}
      {readiness.status === 'missing' && profileHref && readiness.missing.count > 0 ? (
        <p className="mt-1">
          <Link href={profileHref} className={textLink}>
            {t('readiness.answerAhead')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Under the catalogue intro: why there are no badges, or how to get useful ones. */
export function ReadinessHint(props: {
  signedIn: boolean;
  hasProfile: boolean;
  locale: Locale;
  t: Translate;
  signInHref: string;
}) {
  const { signedIn, hasProfile, locale, t } = props;
  if (signedIn && hasProfile) return null;
  return (
    <p className="mt-3 text-sm text-stone-700 dark:text-stone-300">
      {signedIn ? t('readiness.hintNoProfile') : t('readiness.hintSignedOut')}{' '}
      <Link href={signedIn ? `/${locale}/profile` : props.signInHref} className={textLink}>
        {signedIn ? t('readiness.toProfile') : t('nav.signIn')}
      </Link>
    </p>
  );
}
