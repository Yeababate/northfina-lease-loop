// One of the customer's waiting-list requests (#75), opened from its card on My leases or
// from the "Do you still want this?" message. Shows what they asked for, where it stands,
// when they can expect the item, a link to the item offered to them, and the yes/no answer
// once the needed-by date has passed. Only the request's owner can open it.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { StillWantedPrompt } from '@/components/still-wanted-prompt';
import { textLink } from '@/components/ui';
import { expectedLine, waitingListRow, waitingListStatus } from '@/components/waiting-list-section';
import type { AssetCategory } from '@/data/schemas';
import { canAnswerStillWanted, replyLastDay } from '@/domain/waiting-list-follow-up';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { currentPrincipal } from '@/server/current-principal';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';
import { myWaitingListEntry } from '@/server/waiting-list-requests';

export default async function WaitingListEntryPage({
  params,
}: PageProps<'/[locale]/waiting-list/[id]'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const principal = await currentPrincipal();
  if (!principal)
    redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/waiting-list/${id}`)}`);

  const today = todayIso();
  const entry = await myWaitingListEntry(db, principal.id, decodeURIComponent(id), today);
  if (!entry) notFound();
  const t = getT(locale);
  const expected = expectedLine(entry, locale, t);
  // Before the worker has sent the question, the answer is already open; the window then
  // runs from today, as it would if the message went out now.
  const replyBy = entry.replyBy ?? replyLastDay(today);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6">
      <Link href={`/${locale}/leases#waiting-list`} className={textLink}>
        {t('waitlist.entry.back')}
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">
        {t('waitlist.entry.title', { kind: t(`categoryOne.${entry.category as AssetCategory}`) })}
      </h1>

      {canAnswerStillWanted(entry, today) ? (
        <StillWantedPrompt
          locale={locale}
          entryId={entry.id}
          neededBy={entry.neededBy}
          replyBy={replyBy}
          today={today}
        />
      ) : null}

      <section className="rounded-xl border border-stone-300 px-5 py-4 text-sm dark:border-stone-700">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">{t('waitlist.entry.asked')}</dt>
          <dd>{waitingListRow(entry, locale, t)}</dd>
          <dt className="font-semibold">{t('waitlist.entry.status')}</dt>
          <dd>
            {waitingListStatus(entry, t)}
            {entry.expiredOn && entry.expiredReason === 'declined' ? (
              <span className="block text-stone-700 dark:text-stone-300">
                {t('waitlist.entry.expiredDeclined', {
                  date: formatIsoDate(entry.expiredOn, locale),
                })}
              </span>
            ) : null}
            {entry.expiredOn && entry.expiredReason === 'no_reply' ? (
              <span className="block text-stone-700 dark:text-stone-300">
                {t('waitlist.entry.expiredNoReply', {
                  date: formatIsoDate(entry.expiredOn, locale),
                })}
              </span>
            ) : null}
          </dd>
        </dl>
        <p className="mt-3 text-stone-700 dark:text-stone-300">
          {t('waitlist.entry.joined', { date: formatIsoDate(entry.signedUpOn, locale) })}
        </p>
        {expected ? <p className="mt-1 font-medium">{expected}</p> : null}
        {entry.offeredAssetId && entry.status !== 'expired' ? (
          <Link
            href={`/${locale}/items/${encodeURIComponent(entry.offeredAssetId)}?term=${entry.preferredTermMonths}`}
            className={`${textLink} mt-2 inline-block`}
          >
            {t('waitlist.entry.seeItem')}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
