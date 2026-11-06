import type { Asset, AssetCategory, RefurbishmentCosts } from '@/data/schemas';
import { estimateRentalCo2Saving, type ImpactEstimateInput } from './co2-impact';
import { parseRefurbishmentRule } from './refurbishment-rules';
import { AWAITING_SIGNATURE } from './signatory';

export type PassportReading = Pick<Asset, 'condition' | 'usage'>;
export type PassportEnding = 'active' | 'returned' | 'bought_out' | 'exited_early' | 'passed_on';
export type PassportWork = { actionId: string; on: string; costCents: number | null };
export type PassportLifeFact = {
  startOn: string;
  endOn: string | null;
  scheduledEndOn: string;
  ending: PassportEnding;
  termMonths: number;
  monthlyNetCents: number;
  priceSource: 'price_list' | 'next_life';
  priceListVersion: number;
  start: PassportReading | null;
  returned: PassportReading | null;
  priorUsage: number;
  countedCompletion: boolean;
  refurbishment: readonly PassportWork[];
};
type Impact = Pick<ImpactEstimateInput, 'factors' | 'wearPolicy' | 'method'>;

/**
 * A contract counts as a lease life once it is signed. A company application still waiting
 * for its signatory is not a life yet. A legacy contract with no lifecycle row still counts.
 */
export function isLeaseLife(lifecycleStatus: string | null | undefined): boolean {
  return lifecycleStatus !== AWAITING_SIGNATURE;
}

/** Each life uses its signed reading, never the item's latest condition. */
export function buildPassport(input: {
  category: AssetCategory;
  previousLives: number;
  lives: readonly PassportLifeFact[];
  importedWork: readonly PassportWork[];
  impact: Impact | null;
}) {
  const earlierLives = Math.max(
    0,
    input.previousLives - input.lives.filter((life) => life.countedCompletion).length
  );
  let completedLives = earlierLives;
  const lives = input.lives
    .toSorted((a, b) => a.startOn.localeCompare(b.startOn))
    .map((fact, index) => {
      const { priorUsage, countedCompletion, ...life } = fact;
      const estimate =
        life.start && input.impact
          ? estimateRentalCo2Saving({
              ...input.impact,
              asset: { category: input.category, ...life.start },
              termMonths: life.termMonths,
              knownHistory: {
                previousLives: completedLives,
                usage:
                  priorUsage > 0
                    ? { kind: 'reset_with_known_prior', priorUsage }
                    : { kind: 'no_reset_recorded' },
              },
            })
          : null;
      completedLives += Number(countedCompletion);
      return {
        ...life,
        number: earlierLives + index + 1,
        estimatedCo2SavingGrams: estimate?.ok ? estimate.estimate.estimatedSavingGrams : null,
      };
    });
  const work = [...input.importedWork, ...lives.flatMap((life) => life.refurbishment)];
  const estimated = lives.filter((life) => life.estimatedCo2SavingGrams !== null);
  return {
    earlierLives,
    lives,
    importedWork: input.importedWork,
    totals: {
      lives: earlierLives + lives.length,
      estimatedCo2SavingGrams: estimated.length
        ? estimated.reduce((sum, life) => sum + life.estimatedCo2SavingGrams!, 0)
        : null,
      estimatedLives: estimated.length,
      refurbishmentCents: work.reduce((sum, step) => sum + (step.costCents ?? 0), 0),
      unpricedWork: work.filter((step) => step.costCents === null).length,
    },
  };
}

export type ItemPassport = ReturnType<typeof buildPassport>;

/** Reports the data-pack cost of recorded work. Service intervals require an inspection reading. */
export function passportWorkCost(
  actionId: string,
  costs: RefurbishmentCosts[AssetCategory],
  hoursSinceService: number | null
) {
  if (actionId.startsWith('upgrade:'))
    return costs.condition_upgrades[actionId.slice('upgrade:'.length)] ?? null;
  const fixed = costs.fixed.find((step) => step.id === actionId);
  if (!fixed) return null;
  const rule = parseRefurbishmentRule(fixed.when);
  if (rule.kind === 'unknown') return null;
  if (rule.kind !== 'per_started_since_service') return fixed.cost_cents;
  return hoursSinceService === null
    ? null
    : Math.ceil(hoursSinceService / rule.step) * fixed.cost_cents;
}
