import type { ItemPassport as Passport, PassportReading } from '@/domain/passport';
import { formatEuro } from '@/domain/money';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { InfoBox } from './ui';

export function ItemPassport({ passport, locale }: { passport: Passport; locale: Locale }) {
  const t = getT(locale);
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const co2 = (grams: number) => t('passport.co2', { kg: formatNumber(grams / 1000, locale) });
  const reading = (value: PassportReading) =>
    `${t(`condition.${value.condition}`)} · ${t(`usage.${value.usage.unit}`, { value: formatNumber(value.usage.value, locale) })}`;
  return (
    <InfoBox title={t('passport.title')}>
      <p>
        {t('passport.totals', {
          count: passport.totals.lives,
          cost: euro(passport.totals.refurbishmentCents),
        })}
      </p>
      {passport.totals.estimatedCo2SavingGrams !== null ? (
        <p>{co2(passport.totals.estimatedCo2SavingGrams)}</p>
      ) : null}
      {passport.earlierLives ? (
        <p className="mt-2">{t('passport.earlier', { count: passport.earlierLives })}</p>
      ) : null}
      {passport.lives.length ? (
        <ol className="mt-3 space-y-3">
          {passport.lives.map((life) => (
            <li key={life.number}>
              <p className="font-semibold">
                {t('passport.life', { number: life.number })} ·{' '}
                {t(`passport.ending.${life.ending}`)}
              </p>
              <p>
                {formatIsoDate(life.startOn, locale)} →{' '}
                {formatIsoDate(life.endOn ?? life.scheduledEndOn, locale)}
              </p>
              <p>
                {t('contract.monthly', { amount: euro(life.monthlyNetCents) })} ·{' '}
                {life.priceSource === 'next_life'
                  ? t('asset.nextLifePrice')
                  : t('asset.priceListVersion', { version: life.priceListVersion })}
              </p>
              {life.start ? <p>{t('passport.atStart', { reading: reading(life.start) })}</p> : null}
              {life.returned ? (
                <p>{t('passport.atReturn', { reading: reading(life.returned) })}</p>
              ) : null}
              {life.refurbishment.length ? (
                <p>{t('passport.work', { count: life.refurbishment.length })}</p>
              ) : null}
              {life.estimatedCo2SavingGrams !== null ? (
                <p>{co2(life.estimatedCo2SavingGrams)}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </InfoBox>
  );
}
