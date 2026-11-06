// The returned item's next life as a state machine derived from recorded facts:
//
//   received → (lease finalized) → inspected → required work recorded → ready → relisted
//
// The stage is never stored. Every command re-derives it from the same facts, so a relist
// cannot skip inspection, required work, the old lease's end or a competing reservation.
// Dates are ISO strings; a contract's endOn is exclusive (last covered day is endOn − 1).
import type {
  AssetCategory,
  AssetCondition,
  AssetStatus,
  RefurbishmentCosts,
  UsageUnit,
} from '@/data/schemas';
import {
  LISTING_MIN_CONDITION,
  meetsCondition,
  parseUpgradeKey,
  requiredWork,
  upgradeActionId,
  type RequiredAction,
} from './refurbishment-rules';

export type RecordedWork = {
  actionId: string;
  conditionAfter: AssetCondition;
  usageAfter: number;
};

export type Inspection = {
  condition: AssetCondition;
  usageValue: number;
  hoursSinceService: number | null;
};

export type NextLifeFacts = {
  category: AssetCategory;
  usageUnit: UsageUnit;
  /** The lease the item came back from; null for an imported seed return. */
  lease: { endOn: string } | null;
  receivedOn: string | null;
  completedOn: string | null;
  /** Latest inspection, or null. */
  inspection: Inspection | null;
  /** In the order recorded. */
  work: readonly RecordedWork[];
  assetStatus: AssetStatus;
  relistedOn: string | null;
};

export type NextLifeStage = 'awaiting_inspection' | 'needs_work' | 'ready_to_relist' | 'relisted';

export type NextLifeBlocker =
  | 'missing_inspection'
  | 'missing_service_hours'
  | 'unsupported_rule'
  | 'work_incomplete'
  | 'condition_below_listing'
  | 'lease_still_open'
  | 'asset_not_returned';

export type NextLifeView = {
  stage: NextLifeStage;
  /** Received, but the old lease has not been finalized yet: not available for anyone else. */
  onHold: boolean;
  blockers: NextLifeBlocker[];
  required: RequiredAction[];
  /** Required action ids not yet recorded as done. */
  outstanding: string[];
  current: { condition: AssetCondition; usageValue: number } | null;
  canRelist: boolean;
};

/** Condition and counter now: the inspection, then each recorded work step in order. */
export function currentState(facts: Pick<NextLifeFacts, 'inspection' | 'work'>) {
  if (!facts.inspection) return null;
  const last = facts.work.at(-1);
  return last
    ? { condition: last.conditionAfter, usageValue: last.usageAfter }
    : { condition: facts.inspection.condition, usageValue: facts.inspection.usageValue };
}

/** True while an old lease is not finalized. Imported seed returns have no lease to wait for. */
export function isOnHold(facts: Pick<NextLifeFacts, 'lease' | 'completedOn'>): boolean {
  return facts.lease !== null && facts.completedOn === null;
}

/** Where the item is, what is still required and whether relisting is allowed now. */
export function deriveNextLife(
  facts: NextLifeFacts,
  rules: RefurbishmentCosts,
  minimum: AssetCondition = LISTING_MIN_CONDITION
): NextLifeView {
  const onHold = isOnHold(facts);
  const current = currentState(facts);
  if (facts.relistedOn !== null)
    return {
      stage: 'relisted',
      onHold,
      blockers: [],
      required: [],
      outstanding: [],
      current,
      canRelist: false,
    };

  const blockers: NextLifeBlocker[] = [];
  let required: RequiredAction[] = [];
  let outstanding: string[] = [];
  if (!facts.inspection || !current) {
    blockers.push('missing_inspection');
  } else {
    const needs = requiredWork(
      { category: facts.category, usageUnit: facts.usageUnit, ...facts.inspection },
      rules,
      minimum
    );
    required = needs.required;
    const done = new Set(facts.work.map((w) => w.actionId));
    // Fixed steps must each be recorded. A condition upgrade is satisfied by the resulting
    // condition, so an alternative supported path (or a better inspected state) also counts.
    outstanding = required
      .filter((a) =>
        a.kind === 'fixed' ? !done.has(a.id) : !meetsCondition(current.condition, minimum)
      )
      .map((a) => a.id);
    if (needs.missing.length > 0) blockers.push('missing_service_hours');
    if (needs.unsupported.length > 0) blockers.push('unsupported_rule');
    if (outstanding.length > 0) blockers.push('work_incomplete');
    if (!meetsCondition(current.condition, minimum)) blockers.push('condition_below_listing');
  }
  const workBlocked = blockers.length > 0;
  if (onHold) blockers.push('lease_still_open');
  if (facts.assetStatus !== 'returned') blockers.push('asset_not_returned');

  const stage: NextLifeStage = !facts.inspection
    ? 'awaiting_inspection'
    : workBlocked
      ? 'needs_work'
      : 'ready_to_relist';
  return {
    stage,
    onHold,
    blockers,
    required,
    outstanding,
    current,
    canRelist: blockers.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Command guards. Expected failures are values; the server maps them to safe API errors.
// ---------------------------------------------------------------------------

export type ReceiptCheck =
  | { ok: true; completesLease: boolean }
  | { ok: false; reason: 'already_received' | 'lease_not_started' | 'asset_not_leased' };

/**
 * The provider may record physical receipt once the lease has started, including early
 * (D10). Receipt finalizes the lease only when its exclusive end has also been reached;
 * otherwise the item is held until finalizeLease runs on or after endOn.
 */
export function checkReceipt(
  input: { startOn: string; endOn: string; alreadyReceived: boolean; assetStatus: AssetStatus },
  today: string
): ReceiptCheck {
  if (input.alreadyReceived) return { ok: false, reason: 'already_received' };
  if (today < input.startOn) return { ok: false, reason: 'lease_not_started' };
  if (input.assetStatus !== 'reserved') return { ok: false, reason: 'asset_not_leased' };
  return { ok: true, completesLease: input.endOn <= today };
}

/** A received lease is finalized (its life counted once) on or after its exclusive end. */
export function isLeaseDueToComplete(
  facts: { endOn: string; receivedOn: string | null; completedOn: string | null },
  today: string
): boolean {
  return facts.receivedOn !== null && facts.completedOn === null && facts.endOn <= today;
}

export type InspectionInput = {
  condition: AssetCondition;
  usageValue: number;
  hoursSinceService: number | null;
};

export type InspectionCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'already_relisted' | 'work_already_recorded' | 'usage_decreased' | 'invalid_number';
    };

/**
 * Inspection records what came back. It can be repeated until work starts; after that the
 * evidence is fixed. Counters only move forward: a lower reading than recorded is refused
 * (a legitimate reset is recorded as work with resets_usage, never as an inspection).
 */
export function checkInspection(
  input: InspectionInput,
  facts: Pick<NextLifeFacts, 'relistedOn' | 'work'> & { recordedUsage: number }
): InspectionCheck {
  if (facts.relistedOn !== null) return { ok: false, reason: 'already_relisted' };
  if (facts.work.length > 0) return { ok: false, reason: 'work_already_recorded' };
  const numbers = [input.usageValue, input.hoursSinceService ?? 0];
  if (!numbers.every((n) => Number.isSafeInteger(n) && n >= 0))
    return { ok: false, reason: 'invalid_number' };
  if (input.usageValue < facts.recordedUsage) return { ok: false, reason: 'usage_decreased' };
  return { ok: true };
}

export type WorkCheck =
  | {
      ok: true;
      before: { condition: AssetCondition; usageValue: number };
      after: { condition: AssetCondition; usageValue: number };
    }
  | {
      ok: false;
      reason:
        | 'already_relisted'
        | 'missing_inspection'
        | 'unknown_action'
        | 'already_recorded'
        | 'upgrade_from_mismatch';
    };

/**
 * Records one completed step. Fixed steps come from the category's rules; condition steps
 * must start from the current condition. Only a step whose rule has resets_usage sets the
 * counter to zero; the earlier reading stays in the record as usageBefore.
 */
export function checkWork(
  actionId: string,
  facts: Pick<NextLifeFacts, 'category' | 'relistedOn' | 'inspection' | 'work'>,
  rules: RefurbishmentCosts
): WorkCheck {
  if (facts.relistedOn !== null) return { ok: false, reason: 'already_relisted' };
  const before = currentState(facts);
  if (!before) return { ok: false, reason: 'missing_inspection' };
  if (facts.work.some((w) => w.actionId === actionId))
    return { ok: false, reason: 'already_recorded' };
  const category = rules[facts.category];

  const fixed = category.fixed.find((rule) => rule.id === actionId);
  if (fixed)
    return {
      ok: true,
      before,
      after: {
        condition: before.condition,
        usageValue: fixed.resets_usage ? 0 : before.usageValue,
      },
    };

  const step = Object.keys(category.condition_upgrades)
    .map(parseUpgradeKey)
    .find((s) => s !== null && upgradeActionId(s.from, s.to) === actionId);
  if (!step) return { ok: false, reason: 'unknown_action' };
  if (step.from !== before.condition) return { ok: false, reason: 'upgrade_from_mismatch' };
  return { ok: true, before, after: { condition: step.to, usageValue: before.usageValue } };
}
