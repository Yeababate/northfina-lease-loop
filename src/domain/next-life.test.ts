import { beforeAll, describe, expect, it } from 'vitest';
import { loadRefurbishmentCosts } from '@/data/load';
import type { RefurbishmentCosts } from '@/data/schemas';
import {
  checkInspection,
  checkReceipt,
  checkWork,
  currentState,
  deriveNextLife,
  isLeaseDueToComplete,
  isOnHold,
  type NextLifeFacts,
} from './next-life';

let rules: RefurbishmentCosts;
beforeAll(async () => {
  rules = await loadRefurbishmentCosts();
});

const facts = (over: Partial<NextLifeFacts> = {}): NextLifeFacts => ({
  category: 'e_bike',
  usageUnit: 'km',
  lease: { endOn: '2026-11-10' },
  receivedOn: '2026-11-05',
  completedOn: '2026-11-10',
  inspection: { condition: 'fair', usageValue: 18_400, hoursSinceService: null },
  work: [],
  assetStatus: 'returned',
  relistedOn: null,
  ...over,
});
const allWork = [
  { actionId: 'battery_replacement', conditionAfter: 'fair', usageAfter: 0 },
  { actionId: 'safety_inspection', conditionAfter: 'fair', usageAfter: 0 },
  { actionId: 'upgrade:fair->good', conditionAfter: 'good', usageAfter: 0 },
] as const;

describe('deriveNextLife', () => {
  it('waits for inspection first', () => {
    const view = deriveNextLife(facts({ inspection: null }), rules);
    expect(view).toMatchObject({ stage: 'awaiting_inspection', canRelist: false, current: null });
    expect(view.blockers).toContain('missing_inspection');
  });

  it('lists outstanding required work after inspection', () => {
    const view = deriveNextLife(facts(), rules);
    expect(view.stage).toBe('needs_work');
    expect(view.outstanding).toEqual([
      'battery_replacement',
      'safety_inspection',
      'upgrade:fair->good',
    ]);
    expect(view.blockers).toEqual(['work_incomplete', 'condition_below_listing']);
  });

  it('becomes ready only when every required step is recorded', () => {
    const partial = deriveNextLife(facts({ work: allWork.slice(0, 2) }), rules);
    expect(partial.outstanding).toEqual(['upgrade:fair->good']);
    const ready = deriveNextLife(facts({ work: [...allWork] }), rules);
    expect(ready).toMatchObject({ stage: 'ready_to_relist', canRelist: true, blockers: [] });
    expect(ready.current).toEqual({ condition: 'good', usageValue: 0 });
  });

  it('holds a ready item until the old lease is finalized', () => {
    const held = deriveNextLife(facts({ completedOn: null, work: [...allWork] }), rules);
    expect(held).toMatchObject({ stage: 'ready_to_relist', onHold: true, canRelist: false });
    expect(held.blockers).toEqual(['lease_still_open']);
  });

  it('refuses when the asset is no longer in returned stock', () => {
    const reserved = deriveNextLife(facts({ assetStatus: 'reserved', work: [...allWork] }), rules);
    expect(reserved.blockers).toEqual(['asset_not_returned']);
    expect(reserved.canRelist).toBe(false);
  });

  it('asks for service hours for farm machines and treats a seed import as not held', () => {
    const farm = deriveNextLife(
      facts({
        category: 'farm_machine',
        usageUnit: 'engine_hours',
        lease: null,
        receivedOn: null,
        completedOn: null,
        inspection: { condition: 'good', usageValue: 4200, hoursSinceService: null },
      }),
      rules
    );
    expect(farm.onHold).toBe(false);
    expect(farm.blockers).toEqual(['missing_service_hours', 'work_incomplete']);
  });

  it('reports unsupported rules as a blocker', () => {
    const odd = {
      ...rules,
      e_bike: { ...rules.e_bike, fixed: [{ id: 'x', cost_cents: 0, when: '?' }] },
    };
    const view = deriveNextLife(
      facts({ inspection: { condition: 'good', usageValue: 0, hoursSinceService: null } }),
      odd
    );
    expect(view.blockers).toEqual(['unsupported_rule']);
  });

  it('is terminal once relisted', () => {
    expect(deriveNextLife(facts({ relistedOn: '2026-11-12' }), rules)).toMatchObject({
      stage: 'relisted',
      canRelist: false,
    });
  });

  it('accepts a better resulting condition through another path', () => {
    const view = deriveNextLife(
      facts({
        inspection: { condition: 'fair', usageValue: 100, hoursSinceService: null },
        work: [
          { actionId: 'safety_inspection', conditionAfter: 'fair', usageAfter: 100 },
          { actionId: 'upgrade:fair->good', conditionAfter: 'good', usageAfter: 100 },
          { actionId: 'upgrade:good->like_new', conditionAfter: 'like_new', usageAfter: 100 },
        ],
      }),
      rules
    );
    expect(view.canRelist).toBe(true);
    expect(view.current?.condition).toBe('like_new');
  });
});

describe('receipt and completion', () => {
  const base = {
    startOn: '2025-11-10',
    endOn: '2026-11-10',
    alreadyReceived: false,
    assetStatus: 'reserved' as const,
  };

  it('allows early receipt but completes only from the exclusive end', () => {
    expect(checkReceipt(base, '2026-11-09')).toEqual({ ok: true, completesLease: false });
    expect(checkReceipt(base, '2026-11-10')).toEqual({ ok: true, completesLease: true });
  });

  it('refuses duplicates, not-yet-started leases and items not out on lease', () => {
    expect(checkReceipt({ ...base, alreadyReceived: true }, '2026-11-10')).toMatchObject({
      reason: 'already_received',
    });
    expect(checkReceipt(base, '2025-11-09')).toMatchObject({ reason: 'lease_not_started' });
    expect(checkReceipt({ ...base, assetStatus: 'available' }, '2026-11-10')).toMatchObject({
      reason: 'asset_not_leased',
    });
  });

  it('finalizes a received lease once, on or after endOn', () => {
    const lease = { endOn: '2026-11-10', receivedOn: '2026-11-01', completedOn: null };
    expect(isLeaseDueToComplete(lease, '2026-11-09')).toBe(false);
    expect(isLeaseDueToComplete(lease, '2026-11-10')).toBe(true);
    expect(isLeaseDueToComplete({ ...lease, receivedOn: null }, '2026-12-01')).toBe(false);
    expect(isLeaseDueToComplete({ ...lease, completedOn: '2026-11-10' }, '2026-12-01')).toBe(false);
    expect(isOnHold({ lease: { endOn: '2026-11-10' }, completedOn: null })).toBe(true);
  });
});

describe('checkInspection', () => {
  const input = { condition: 'fair' as const, usageValue: 18_400, hoursSinceService: null };
  it('accepts a first or repeated inspection before work', () => {
    expect(checkInspection(input, { relistedOn: null, work: [], recordedUsage: 18_400 })).toEqual({
      ok: true,
    });
  });
  it('refuses lower counters, negative or fractional numbers and changes after work', () => {
    const f = { relistedOn: null, work: [], recordedUsage: 18_400 };
    expect(checkInspection({ ...input, usageValue: 18_399 }, f)).toMatchObject({
      reason: 'usage_decreased',
    });
    expect(checkInspection({ ...input, usageValue: -1 }, f)).toMatchObject({
      reason: 'invalid_number',
    });
    expect(checkInspection({ ...input, hoursSinceService: 1.5 }, f)).toMatchObject({
      reason: 'invalid_number',
    });
    expect(checkInspection(input, { ...f, work: [allWork[0]] })).toMatchObject({
      reason: 'work_already_recorded',
    });
    expect(checkInspection(input, { ...f, relistedOn: '2026-11-11' })).toMatchObject({
      reason: 'already_relisted',
    });
  });
});

describe('checkWork', () => {
  it('resets usage only for a step whose rule says so and keeps the reading before', () => {
    expect(checkWork('battery_replacement', facts(), rules)).toEqual({
      ok: true,
      before: { condition: 'fair', usageValue: 18_400 },
      after: { condition: 'fair', usageValue: 0 },
    });
    expect(checkWork('safety_inspection', facts(), rules)).toMatchObject({
      after: { usageValue: 18_400 },
    });
  });

  it('moves condition one recorded step at a time from the current condition', () => {
    expect(checkWork('upgrade:fair->good', facts(), rules)).toMatchObject({
      after: { condition: 'good' },
    });
    expect(checkWork('upgrade:poor->fair', facts(), rules)).toMatchObject({
      reason: 'upgrade_from_mismatch',
    });
  });

  it('refuses unknown, duplicate, uninspected and relisted work', () => {
    expect(checkWork('certified_data_wipe', facts(), rules)).toMatchObject({
      reason: 'unknown_action',
    });
    expect(checkWork('battery_replacement', facts({ work: [allWork[0]] }), rules)).toMatchObject({
      reason: 'already_recorded',
    });
    expect(checkWork('safety_inspection', facts({ inspection: null }), rules)).toMatchObject({
      reason: 'missing_inspection',
    });
    expect(
      checkWork('safety_inspection', facts({ relistedOn: '2026-11-11' }), rules)
    ).toMatchObject({ reason: 'already_relisted' });
  });

  it('derives the current state from the last work step', () => {
    expect(currentState({ inspection: null, work: [] })).toBeNull();
    expect(currentState(facts({ work: [...allWork] }))).toEqual({
      condition: 'good',
      usageValue: 0,
    });
  });
});
