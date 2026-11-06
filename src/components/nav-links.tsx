'use client';

// The main navigation. A client component only to underline the section you are in.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Locale } from '@/i18n/locales';

type NavLinksProps = {
  locale: Locale;
  label: string;
  catalogueLabel: string;
  leasesLabel: string;
  dealsLabel: string;
  /** "My answers" (#52); only when signed in. */
  profileLabel?: string;
  dealersLabel: string;
};

export function NavLinks({
  locale,
  label,
  catalogueLabel,
  leasesLabel,
  dealsLabel,
  profileLabel,
  dealersLabel,
}: NavLinksProps) {
  const pathname = usePathname();
  const section = pathname.split('/')[2] ?? '';
  const links = [
    // The catalogue is the home page, and item pages belong to it.
    { href: `/${locale}`, text: catalogueLabel, active: section === '' || section === 'items' },
    { href: `/${locale}/leases`, text: leasesLabel, active: section === 'leases' },
    { href: `/${locale}/deals`, text: dealsLabel, active: section === 'deals' },
    ...(profileLabel
      ? [{ href: `/${locale}/profile`, text: profileLabel, active: section === 'profile' }]
      : []),
    { href: `/${locale}/dealers`, text: dealersLabel, active: section === 'dealers' },
  ];

  return (
    <nav aria-label={label}>
      <ul className="flex gap-6">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={link.active ? 'page' : undefined}
              className={
                'block border-b-2 py-1 font-medium transition-colors ' +
                (link.active
                  ? 'border-blue-600 text-stone-950 dark:border-blue-400 dark:text-white'
                  : 'border-transparent text-stone-600 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white')
              }
            >
              {link.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
