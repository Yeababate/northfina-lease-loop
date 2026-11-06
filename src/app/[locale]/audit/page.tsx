// The audit trail (RULES.md §7): who did what and when, newest first. Filter by entity type
// and/or id; each row links to the page where its entity can be seen. Uses the same public
// audience as GET /api/audit-log, so moderation evidence never appears here.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { secondaryButton, textLink } from '@/components/ui';
import { AUDIT_ENTITY_TYPES, auditEntityPath } from '@/domain/audit-links';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { listAuditLog } from '@/server/audit';
import { db } from '@/server/db';

const LIMIT = 100;
/** Times are shown in Finnish time, where the leases are signed. */
const TIME_ZONE = 'Europe/Helsinki';

function single(value: string | string[] | undefined): string {
  const text = (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  return text.length <= 200 ? text : '';
}

export default async function AuditPage({ params, searchParams }: PageProps<'/[locale]/audit'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const t = getT(locale);
  const query = await searchParams;
  const entityType = single(query.entityType);
  const entityId = single(query.entityId);
  const rows = await listAuditLog(db, LIMIT, 'public', {
    entityType: entityType || undefined,
    entityId: entityId || undefined,
  });
  const time = new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: TIME_ZONE,
  });
  const inputClass =
    'mt-1 rounded-lg border border-stone-400 bg-white px-2 py-1.5 dark:border-stone-600 dark:bg-stone-900';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('audit.title')}</h1>
      <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
        {t('audit.intro', { count: LIMIT })}
      </p>

      <form className="mt-6 flex flex-wrap items-end gap-3 text-sm" aria-label={t('audit.filter')}>
        <label className="flex flex-col">
          {t('audit.entityType')}
          <select name="entityType" defaultValue={entityType} className={inputClass}>
            <option value="">{t('audit.allTypes')}</option>
            {AUDIT_ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          {t('audit.entityId')}
          <input name="entityId" defaultValue={entityId} className={inputClass} maxLength={200} />
        </label>
        <button type="submit" className={secondaryButton}>
          {t('audit.apply')}
        </button>
        {entityType || entityId ? (
          <Link href={`/${locale}/audit`} className={textLink}>
            {t('audit.clear')}
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm">{t('audit.empty')}</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-stone-300 dark:border-stone-700">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('audit.title')}</caption>
            <thead className="bg-stone-50 dark:bg-stone-900">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('audit.when')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('audit.who')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('audit.what')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('audit.entity')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('audit.details')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const path = auditEntityPath(row.entity_type, row.entity_id);
                return (
                  <tr
                    key={row.id}
                    className="border-t border-stone-200 align-top dark:border-stone-800"
                  >
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {time.format(new Date(row.created_at))}
                    </td>
                    <td className="px-3 py-2 break-all">{row.actor}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.action}</td>
                    <td className="px-3 py-2">
                      <span className="text-stone-600 dark:text-stone-400">{row.entity_type}</span>{' '}
                      {path ? (
                        <Link href={`/${locale}/${path}`} className={`${textLink} break-all`}>
                          {row.entity_id}
                        </Link>
                      ) : (
                        <span className="break-all">{row.entity_id}</span>
                      )}{' '}
                      <Link
                        href={`/${locale}/audit?entityType=${encodeURIComponent(row.entity_type)}&entityId=${encodeURIComponent(row.entity_id)}`}
                        className={`${textLink} text-xs`}
                      >
                        {t('audit.onlyThis')}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {row.details === null ? (
                        '—'
                      ) : (
                        <details>
                          <summary className={`${textLink} cursor-pointer`}>
                            {t('audit.show')}
                          </summary>
                          <pre className="mt-1 max-w-md overflow-x-auto text-xs whitespace-pre-wrap">
                            {JSON.stringify(row.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
