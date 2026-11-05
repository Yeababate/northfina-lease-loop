// The demo name screen (issue #1): a centred card asking what to call the visitor. Reached
// from "Apply to lease" (the proxy sends visitors without a name here) or the header's
// "Sign in" link. `next` is where to continue afterwards.
import { notFound } from 'next/navigation';
import { SignInForm } from '@/components/sign-in-form';
import { safeNextPath } from '@/domain/demo-name';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { readDemoName } from '@/server/demo-session';

export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const query = await searchParams;
  const next = safeNextPath(typeof query.next === 'string' ? query.next : null, `/${locale}`);
  const currentName = await readDemoName();

  return (
    <div className="flex justify-center px-4 py-12 sm:py-16">
      <section
        aria-labelledby="sign-in-title"
        className="w-full max-w-md rounded-2xl border border-stone-300 p-6 sm:p-8 dark:border-stone-700"
      >
        <h1 id="sign-in-title" className="text-2xl font-semibold tracking-tight">
          {t('signIn.title')}
        </h1>
        <p className="mt-2 text-stone-700 dark:text-stone-300">{t('signIn.intro')}</p>
        <SignInForm locale={locale} next={next} currentName={currentName} />
        <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">{t('signIn.privacy')}</p>
      </section>
    </div>
  );
}
