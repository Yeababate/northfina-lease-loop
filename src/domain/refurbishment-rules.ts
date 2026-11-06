// Which work a returned item needs before its next lease, read from the `when`, `resets_usage`
// and `condition_upgrades` facts in data/refurbishment-costs.json. Cost amounts are not read
// here: this module decides what must be done, not what it costs.
import type { AssetCategory, AssetCondition, RefurbishmentCosts, UsageUnit } from '@/data/schemas';

/** Worst first. */
export const CONDITION_ORDER: readonly AssetCondition[] = [
  'poor',
  'fair',
  'good',
  'like_new',
  'new',
];

/**
 * A generic catalogue listing needs at least this condition (data pack note). Placing a fair
 * item directly with a waiting-list entry that accepts fair is not implemented, so fair
 * returns are never relisted silently.
 */
export const LISTING_MIN_CONDITION = 'good';

export function conditionRank(condition: AssetCondition): number {
  return CONDITION_ORDER.indexOf(condition);
}

export function meetsCondition(condition: AssetCondition, minimum: AssetCondition): boolean {
  return conditionRank(condition) >= conditionRank(minimum);
}

export type ParsedRule =
  | { kind: 'always' }
  | { kind: 'usage_at_least'; threshold: number; unit: UsageUnit }
  | { kind: 'per_started_since_service'; step: number; unit: UsageUnit }
  | { kind: 'unknown' };

const USAGE_AT_LEAST = /^usage\.value >= (\d+) (km|battery_cycles|engine_hours)$/;
const PER_STARTED = /^per started (\d+) (km|battery_cycles|engine_hours) since last service$/;

/** Turns the data pack's `when` text into an explicit predicate. Unknown text stays unknown. */
export function parseRefurbishmentRule(when: string): ParsedRule {
  const text = when.trim();
  if (text === 'always') return { kind: 'always' };
  const atLeast = USAGE_AT_LEAST.exec(text);
  if (atLeast)
    return { kind: 'usage_at_least', threshold: Number(atLeast[1]), unit: atLeast[2] as UsageUnit };
  const perStarted = PER_STARTED.exec(text);
  if (perStarted && Number(perStarted[1]) > 0)
    return {
      kind: 'per_started_since_service',
      step: Number(perStarted[1]),
      unit: perStarted[2] as UsageUnit,
    };
  return { kind: 'unknown' };
}

export type InspectedState = {
  category: AssetCategory;
  condition: AssetCondition;
  usageUnit: UsageUnit;
  usageValue: number;
  /** Units since the last service, when known. Never assumed from the lifetime counter. */
  hoursSinceService: number | null;
};

export type RequiredAction =
  | {
      id: string;
      kind: 'fixed';
      reason: 'always' | 'usage_threshold' | 'service_interval';
      resetsUsage: boolean;
      /** Started service intervals, for `per started N` rules; otherwise 1. */
      quantity: number;
    }
  | {
      id: string;
      kind: 'upgrade';
      reason: 'condition_below_listing';
      from: AssetCondition;
      to: AssetCondition;
    };

export type WorkRequirements = {
  required: RequiredAction[];
  /** Facts the provider must supply before the requirements are complete. */
  missing: 'hours_since_service'[];
  /** Rule ids whose `when` text cannot be interpreted, or 'no_upgrade_path'. */
  unsupported: string[];
};

/** The id used for a condition step in work records: `upgrade:fair->good`. */
export function upgradeActionId(from: AssetCondition, to: AssetCondition): string {
  return `upgrade:${from}->${to}`;
}

/**
 * Every applicable safety/service/data step for the category, plus the condition-upgrade
 * path that reaches the listing minimum. All of them are required: a provider cannot skip a
 * required step, only record that it was done. A rule on a different counter than the asset's
 * (for example km on a laptop) is reported as unsupported rather than guessed.
 */
export function requiredWork(
  state: InspectedState,
  rules: RefurbishmentCosts,
  minimum: AssetCondition = LISTING_MIN_CONDITION
): WorkRequirements {
  const category = rules[state.category];
  const required: RequiredAction[] = [];
  const missing: 'hours_since_service'[] = [];
  const unsupported: string[] = [];

  for (const rule of category.fixed) {
    const parsed = parseRefurbishmentRule(rule.when);
    const resetsUsage = rule.resets_usage === true;
    if (
      parsed.kind === 'unknown' ||
      (parsed.kind !== 'always' && parsed.unit !== state.usageUnit)
    ) {
      unsupported.push(rule.id);
    } else if (parsed.kind === 'always') {
      required.push({ id: rule.id, kind: 'fixed', reason: 'always', resetsUsage, quantity: 1 });
    } else if (parsed.kind === 'usage_at_least') {
      if (state.usageValue >= parsed.threshold)
        required.push({
          id: rule.id,
          kind: 'fixed',
          reason: 'usage_threshold',
          resetsUsage,
          quantity: 1,
        });
    } else if (state.hoursSinceService === null) {
      missing.push('hours_since_service');
    } else {
      const quantity = Math.ceil(state.hoursSinceService / parsed.step);
      if (quantity > 0)
        required.push({
          id: rule.id,
          kind: 'fixed',
          reason: 'service_interval',
          resetsUsage,
          quantity,
        });
    }
  }

  const path = upgradePath(state.condition, Object.keys(category.condition_upgrades), minimum);
  if (path === null) unsupported.push('no_upgrade_path');
  else
    for (const step of path)
      required.push({
        id: upgradeActionId(step.from, step.to),
        kind: 'upgrade',
        reason: 'condition_below_listing',
        from: step.from,
        to: step.to,
      });

  return { required, missing, unsupported };
}

type Step = { from: AssetCondition; to: AssetCondition };

/** Parses `"fair->good"` into a step that improves the condition, or null. */
export function parseUpgradeKey(key: string): Step | null {
  const [from, to, extra] = key.split('->');
  if (extra !== undefined || !isCondition(from) || !isCondition(to)) return null;
  return conditionRank(to) > conditionRank(from) ? { from, to } : null;
}

/**
 * Fewest supported steps from `from` to the minimum condition (breadth-first). Multi-step paths
 * such as poor->fair->good are chained from the data; a direct step is used only if the
 * data names one. [] when already good enough, null when the data offers no way there.
 */
export function upgradePath(
  from: AssetCondition,
  upgradeKeys: readonly string[],
  minimum: AssetCondition = LISTING_MIN_CONDITION
): Step[] | null {
  if (meetsCondition(from, minimum)) return [];
  const steps = upgradeKeys.map(parseUpgradeKey).filter((step): step is Step => step !== null);
  const queue: { at: AssetCondition; path: Step[] }[] = [{ at: from, path: [] }];
  const seen = new Set<AssetCondition>([from]);
  while (queue.length > 0) {
    const { at, path } = queue.shift()!;
    for (const step of steps.filter((s) => s.from === at)) {
      if (seen.has(step.to)) continue;
      const next = [...path, step];
      if (meetsCondition(step.to, minimum)) return next;
      seen.add(step.to);
      queue.push({ at: step.to, path: next });
    }
  }
  return null;
}

function isCondition(value: string | undefined): value is AssetCondition {
  return value !== undefined && (CONDITION_ORDER as readonly string[]).includes(value);
}
