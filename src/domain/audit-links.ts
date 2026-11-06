// Where an audit row's entity can be seen in the app. Pure: the audit page asks this for each
// row, so the mapping from entity types to pages lives in one tested place.

/** Entity types the audit page offers as filters, in the order shown. */
export const AUDIT_ENTITY_TYPES = [
  'contract',
  'exit',
  'asset',
  'return_intake',
  'return',
  'waiting_list',
  'rating',
  'quote',
] as const;

/**
 * The locale-relative page for an entity (`contracts/c-1`), or null when there is no page
 * for it. Ids are URI-encoded, so an id can never change the path.
 */
export function auditEntityPath(entityType: string, entityId: string): string | null {
  if (entityId.trim() === '') return null;
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case 'contract':
      return `contracts/${id}`;
    case 'asset':
      return `items/${id}`;
    // Both names are used for a returned item's intake (see next-life-commands, waiting-list).
    case 'return_intake':
    case 'return':
      return `returns?intake=${id}`;
    case 'waiting_list':
      return `waiting-list/${id}`;
    default:
      return null;
  }
}
