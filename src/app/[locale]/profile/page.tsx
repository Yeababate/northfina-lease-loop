// Profile → My answers (#52): the remembered application answers, the whole questionnaire
// for one customer type, and what the answers mean for every lease (the sticky flags).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { MyAnswers } from '@/components/profile/my-answers';
import { InfoBox, textLink } from '@/components/ui';
import { loadQuestions } from '@/data/load';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { rememberedSetsFor } from '@/server/catalogue-readiness';
import { currentPrincipal } from '@/server/current-principal';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

export default async function ProfilePage({ params }: PageProps<'/[locale]/profile'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();

  const t = getT(locale);
  const principal = await currentPrincipal();
  const { questions } = await loadQuestions();
  const sets = principal ? await rememberedSetsFor(db, principal.id, questions, todayIso()) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('myAnswers.title')}</h1>
      <p className="mt-2 text-stone-700 dark:text-stone-300">{t('myAnswers.intro')}</p>
      {sets === null ? (
        <div className="mt-6">
          <InfoBox>
            <p>
              {t('myAnswers.signedOut')}{' '}
              <Link
                href={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/profile`)}`}
                className={textLink}
              >
                {t('nav.signIn')}
              </Link>
            </p>
          </InfoBox>
        </div>
      ) : (
        <MyAnswers locale={locale} questions={questions} initialSets={sets} />
      )}
    </div>
  );
}
