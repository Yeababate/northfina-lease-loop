// The sentence shown when an item cannot be leased right now: reserved for someone else, or
// back from a lease and being refurbished before it is relisted.
import type { Asset } from '@/data/schemas';
import { unavailableReason } from '@/domain/catalogue';
import type { Translate } from '@/i18n/get-t';

export function unavailableMessage(asset: Asset, t: Translate): string {
  return unavailableReason(asset) === 'being_refurbished'
    ? t('item.refurbishing')
    : t('item.reserved');
}
