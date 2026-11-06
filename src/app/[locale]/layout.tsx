// The root layout. Every page lives under /[locale] (/en, /fi, /sv, /et), so the
// <html lang> attribute is always right for the page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { NavLinks } from '@/components/nav-links';
import { SignInLink } from '@/components/sign-in-link';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { readDemoName } from '@/server/demo-session';
import { demoToday } from '@/server/today';
import { formatIsoDate } from '@/i18n/format';
import { signOut } from './sign-in/actions';
import '../globals.css';

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('meta.title'), description: t('meta.description') };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const name = await readDemoName();

  return (
    <html lang={locale}>
      <body className="flex min-h-dvh flex-col bg-white text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-10 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-stone-900 focus:shadow"
        >
          {t('nav.skipToContent')}
        </a>

        <header className="border-b border-stone-200 dark:border-stone-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-6">
            <Link href={`/${locale}`} className="flex items-center gap-3 rounded-lg">
              <span aria-hidden="true" className="size-7 rounded-lg bg-blue-600 dark:bg-blue-500" />
              <span className="text-lg font-semibold tracking-tight">{t('brand.name')}</span>
            </Link>
            <NavLinks
              locale={locale}
              label={t('nav.main')}
              catalogueLabel={t('nav.catalogue')}
              leasesLabel={t('nav.myLeases')}
              dealsLabel={t('deals.nav')}
              profileLabel={name ? t('nav.profile') : undefined}
            />
            <div className="ml-auto flex items-center gap-6">
              <LanguageSwitcher current={locale} label={t('nav.language')} />
              {name ? (
                <div className="flex items-center gap-2 text-sm">
                  <p>{t('nav.greeting', { name })}</p>
                  <span aria-hidden="true" className="text-stone-400">
                    ·
                  </span>
                  <form action={signOut}>
                    <input type="hidden" name="locale" value={locale} />
                    <button
                      type="submit"
                      className="text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300"
                    >
                      {t('nav.signOut')}
                    </button>
                  </form>
                </div>
              ) : (
                <SignInLink locale={locale} label={t('nav.signIn')} />
              )}
            </div>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        {/* Dealer tools stay reachable for the demo, but out of the customer's main menu. */}
        <footer className="border-t border-stone-200 dark:border-stone-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 text-sm text-stone-600 sm:px-6 dark:text-stone-400">
            {demoToday() ? (
              <span className="rounded-full bg-orange-100 px-2.5 py-0.5 font-medium text-orange-900 dark:bg-orange-950 dark:text-orange-200">
                {t('footer.demoDate', { date: formatIsoDate(demoToday() ?? '', locale) })}
              </span>
            ) : null}
            <span>{t('footer.forDealers')}</span>
            <Link
              href={`/${locale}/discounts`}
              className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-white"
            >
              {t('discount.manage')}
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
