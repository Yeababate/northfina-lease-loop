import type { VatRates } from '@/data/schemas';
import { addCalendarDays } from './local-time';
import { vatCents, vatRateOn } from './vat';

export const END_TERM_NOTICE_DAYS = 30;
export type EndTermKind = 'end_buyout' | 'end_return' | 'pass_on';

export function endOfTermBuyout(netCents: number, on: string, vat: VatRates) {
  const result = vatRateOn(vat.rates, on);
  if (!result.ok) return result;
  const tax = vatCents(netCents, result.rate.rate_percent);
  return {
    ok: true,
    price: {
      netCents,
      vatCents: tax,
      grossCents: netCents + tax,
      vatRatePercent: result.rate.rate_percent,
    },
  } as const;
}

/** A renter can choose from 30 days before the exclusive end date through the end date. */
export function endOfTermOptions(
  contract: { endOn: string; status: string; buyoutNetCents: number },
  today: string,
  vat: VatRates
) {
  const opensOn = addCalendarDays(contract.endOn, -END_TERM_NOTICE_DAYS);
  const closesOn = contract.endOn;
  const available = contract.status === 'active' && today >= opensOn && today <= closesOn;
  const buyout = endOfTermBuyout(contract.buyoutNetCents, today, vat);
  return {
    opensOn,
    closesOn,
    available,
    options: available
      ? {
          end_buyout: buyout.ok ? buyout.price : null,
          end_return: { netCents: 0, vatCents: 0, grossCents: 0 },
          pass_on: { requiresNewContract: true },
        }
      : null,
  };
}
