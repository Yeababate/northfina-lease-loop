// Plain-language hints for a question's `ask_when` (#52): "only asked for farm machines",
// "only asked for leases from €10,000". The profile page shows every question that could
// apply to a customer type, so it says when each one is actually asked. This module only
// turns the conditions into structured hints; the page puts them into words per language.
import type { AskWhenCondition } from '@/data/schemas';

export type AskWhenHint =
  | { kind: 'customer_type'; types: string[] }
  | { kind: 'category'; categories: string[] }
  /** Financed amount in cents; `from` and `upTo` are inclusive, either can be left out. */
  | { kind: 'amount'; fromCents?: number; upToCents?: number }
  | { kind: 'term'; fromMonths?: number; upToMonths?: number }
  /** Asked only after this answer to an earlier question. */
  | { kind: 'answer'; questionId: string; values: string[] };

type Range = { from?: number; upTo?: number };

/** Narrows a range: several `gte` keep the highest, several `lte` the lowest. */
function narrow(range: Range, condition: AskWhenCondition): Range {
  if (condition.op === 'gte') {
    return { ...range, from: Math.max(range.from ?? condition.value, condition.value) };
  }
  if (condition.op === 'lte') {
    return { ...range, upTo: Math.min(range.upTo ?? condition.value, condition.value) };
  }
  return range;
}

/**
 * Hints in a fixed order (customer type, item, amount, term, earlier answers), whatever
 * order the conditions come in. Several `gte`/`lte` on one field become one range,
 * because every condition must hold. An empty list ("always asked") gives no hints. Like
 * the engine (`conditionHolds`), `in` is read only on text fields and `gte`/`lte` only on
 * numbers; any other combination never matches, so it is left out rather than guessed at.
 */
export function describeAskWhen(conditions: readonly AskWhenCondition[]): AskWhenHint[] {
  const hints: AskWhenHint[] = [];
  const of = (field: string) => conditions.filter((c) => c.field === field);

  for (const c of of('customer_type')) {
    if (c.op === 'in') hints.push({ kind: 'customer_type', types: [...c.value] });
  }
  for (const c of of('category')) {
    if (c.op === 'in') hints.push({ kind: 'category', categories: [...c.value] });
  }

  const amount = of('financed_amount_cents').reduce<Range>(narrow, {});
  if (amount.from !== undefined || amount.upTo !== undefined) {
    hints.push({
      kind: 'amount',
      ...(amount.from !== undefined ? { fromCents: amount.from } : {}),
      ...(amount.upTo !== undefined ? { upToCents: amount.upTo } : {}),
    });
  }

  const term = of('term_months').reduce<Range>(narrow, {});
  if (term.from !== undefined || term.upTo !== undefined) {
    hints.push({
      kind: 'term',
      ...(term.from !== undefined ? { fromMonths: term.from } : {}),
      ...(term.upTo !== undefined ? { upToMonths: term.upTo } : {}),
    });
  }

  for (const c of conditions) {
    if (c.field.startsWith('answers.') && c.op === 'in') {
      hints.push({
        kind: 'answer',
        questionId: c.field.slice('answers.'.length),
        values: [...c.value],
      });
    }
  }
  return hints;
}
