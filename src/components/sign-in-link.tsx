'use client';

// "Sign in" in the header when no demo name is set. A client component only to come back
// to the page the visitor is on after giving a name.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Locale } from '@/i18n/locales';

export function SignInLink({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const next = new URLSearchParams({ next: pathname });
  return (
    <Link
      href={`/${locale}/sign-in?${next}`}
      className="text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300"
    >
      {label}
    </Link>
  );
}
