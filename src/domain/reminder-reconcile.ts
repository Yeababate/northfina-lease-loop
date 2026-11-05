// What happens to saved reminder occurrences when the settings (or the lease end) change.
//
// - Delivered (`covered`) occurrences are history: never changed, never sent again.
// - A pending occurrence still in the new plan is moved to its new time and channels.
// - A pending occurrence no longer in the plan (rule removed or disabled, offset changed,
//   end date changed, reminders switched off) is cancelled.
// - A time that is already past when the change is saved is not backfilled.
import type { PlannedOccurrence } from './reminder-schedule';

export type OccurrenceStatus = 'pending' | 'covered' | 'cancelled' | 'skipped_past';

export type SavedOccurrence = {
  id: string;
  key: string;
  status: OccurrenceStatus;
};

export type ReconcileAction =
  | { kind: 'create'; planned: PlannedOccurrence; status: 'pending' | 'skipped_past' }
  | {
      kind: 'update';
      id: string;
      planned: PlannedOccurrence;
      status: 'pending' | 'skipped_past';
    }
  | { kind: 'cancel'; id: string }
  | { kind: 'keep'; id: string };

function plannedStatus(planned: PlannedOccurrence): 'pending' | 'skipped_past' {
  return planned.state === 'scheduled' ? 'pending' : 'skipped_past';
}

/** One action per saved occurrence and per new planned occurrence. */
export function reconcileOccurrences(
  saved: readonly SavedOccurrence[],
  planned: readonly PlannedOccurrence[]
): ReconcileAction[] {
  const byKey = new Map(saved.map((occurrence) => [occurrence.key, occurrence]));
  const plannedKeys = new Set(planned.map((occurrence) => occurrence.key));
  const actions: ReconcileAction[] = [];
  for (const occurrence of saved) {
    if (occurrence.status === 'covered') actions.push({ kind: 'keep', id: occurrence.id });
    else if (!plannedKeys.has(occurrence.key)) {
      actions.push(
        occurrence.status === 'pending'
          ? { kind: 'cancel', id: occurrence.id }
          : { kind: 'keep', id: occurrence.id }
      );
    }
  }
  for (const next of planned) {
    const existing = byKey.get(next.key);
    if (!existing) actions.push({ kind: 'create', planned: next, status: plannedStatus(next) });
    else if (existing.status !== 'covered')
      actions.push({ kind: 'update', id: existing.id, planned: next, status: plannedStatus(next) });
  }
  return actions;
}
