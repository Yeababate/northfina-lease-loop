// A lease's history in plain words, for the "Activity" section on the contract page. The
// audit log (src/server/audit.ts) records every change; this turns the rows about one lease
// into customer-facing events: who did what, and the few facts worth showing. Technical rows
// (data repairs, seeding) and actions it does not know are left out rather than guessed at.

export type AuditRow = {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  details: unknown;
};

/** Who did it, from the viewer's point of view. */
export type ActivityActor = { kind: 'you' } | { kind: 'person'; name: string } | { kind: 'system' };

export type ActivityEvent =
  | { type: 'signed'; termMonths: number | null; monthlyNetCents: number | null }
  /** Card 6: saved and sent to the company's signatory instead of signed. */
  | { type: 'sent_to_signatory'; email: string }
  | { type: 'signatory_signed' }
  | { type: 'invoices_issued' }
  | { type: 'reminders'; enabled: boolean }
  | {
      type: 'exit_requested';
      kind: 'return' | 'buyout';
      amountNetCents: number | null;
      effectiveEndOn: string | null;
    }
  | { type: 'exit_withdrawn' }
  | { type: 'return_received' }
  | { type: 'return_completed' }
  | { type: 'buyout_paid' }
  | { type: 'rated' }
  | { type: 'rating_edited' };

export type ActivityItem = { id: number; at: string; actor: ActivityActor; event: ActivityEvent };

export type ActivityViewer = {
  /** The viewer's participant id. */
  id: string;
  /** Older rows store the signer's display name as the actor, so it is matched too. */
  displayName: string;
};

/**
 * Rows about one lease → events, newest first. `names` maps participant ids to display
 * names; actors starting with "system:" are Lease Loop itself.
 */
export function leaseActivity(
  rows: readonly AuditRow[],
  viewer: ActivityViewer,
  names: ReadonlyMap<string, string>
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const row of rows) {
    const event = toEvent(row.action, row.details);
    if (!event) continue;
    items.push({ id: row.id, at: row.created_at, actor: actorOf(row.actor, viewer, names), event });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
}

function actorOf(
  actor: string,
  viewer: ActivityViewer,
  names: ReadonlyMap<string, string>
): ActivityActor {
  if (actor === viewer.id || actor === viewer.displayName) return { kind: 'you' };
  if (actor.startsWith('system:')) return { kind: 'system' };
  return { kind: 'person', name: names.get(actor) ?? actor };
}

function toEvent(action: string, details: unknown): ActivityEvent | null {
  const d = isRecord(details) ? details : {};
  switch (action) {
    case 'contract.signed':
      if (typeof d.awaitingSignatory === 'string')
        return { type: 'sent_to_signatory', email: d.awaitingSignatory };
      return {
        type: 'signed',
        termMonths: wholeNumber(d.termMonths),
        monthlyNetCents: wholeNumber(d.monthlyNetCents),
      };
    case 'contract.signatory_signed':
      return { type: 'signatory_signed' };
    case 'invoices.generated':
      return { type: 'invoices_issued' };
    case 'reminder_preferences.updated': {
      const preferences = isRecord(d.preferences) ? d.preferences : {};
      return typeof preferences.enabled === 'boolean'
        ? { type: 'reminders', enabled: preferences.enabled }
        : null;
    }
    case 'exit.requested': {
      const quote = isRecord(d.quote) ? d.quote : {};
      const kind = d.kind === 'buyout' || d.kind === 'return' ? d.kind : null;
      if (!kind) return null;
      return {
        type: 'exit_requested',
        kind,
        amountNetCents: wholeNumber(quote.amountNetCents),
        effectiveEndOn: typeof quote.effectiveEndOn === 'string' ? quote.effectiveEndOn : null,
      };
    }
    case 'exit.withdrawn':
      return { type: 'exit_withdrawn' };
    case 'exit.return_received':
      return { type: 'return_received' };
    case 'exit.return_finalized':
      return { type: 'return_completed' };
    case 'exit.buyout_paid':
      return { type: 'buyout_paid' };
    case 'rating.created':
      return { type: 'rated' };
    case 'rating.edited':
      return { type: 'rating_edited' };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}
