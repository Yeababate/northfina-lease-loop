import { beforeAll, describe, expect, it } from 'vitest';
import { loadCo2Factors } from '@/data/load';
import type { Co2Factors } from '@/data/schemas';
import { buildFactorSet, buildHackathonFactorSet, HACKATHON_FACTOR_SET } from './co2-factors';

let factors: Co2Factors;
beforeAll(async () => {
  factors = await loadCo2Factors();
});

const meta = { id: 'test', version: 7, status: 'sourced' as const, sourceReference: 'test' };

describe('buildHackathonFactorSet', () => {
  it('converts the supplied kg factors to whole grams and the share to ppm', () => {
    const result = buildHackathonFactorSet(factors);
    expect(result).toEqual({
      ok: true,
      factorSet: {
        ...HACKATHON_FACTOR_SET,
        status: 'fictional_illustrative',
        unit: 'g_co2e',
        sourceReference: 'data/co2-factors.json (Lease Loop hackathon data pack)',
        sourceNote: factors.note,
        manufacturingNewGrams: { e_bike: 165_000, laptop: 330_000, farm_machine: 18_000_000 },
        refurbishmentShareOfNewPpm: 120_000,
        carDisplacementGramsPerKm: 150,
      },
    });
  });

  it('keeps the fictional source note so the UI can say where numbers came from', () => {
    const result = buildHackathonFactorSet(factors);
    expect(result.ok && result.factorSet.sourceNote).toMatch(/FICTIONAL/);
  });
});

describe('buildFactorSet', () => {
  it('carries the given id, version and status', () => {
    const result = buildFactorSet(factors, meta);
    expect(result.ok && [result.factorSet.id, result.factorSet.version]).toEqual(['test', 7]);
    expect(result.ok && result.factorSet.status).toBe('sourced');
  });

  it('accepts a factor down to the gram (0.001 kg)', () => {
    const result = buildFactorSet(
      { ...factors, manufacturing_new_kg: { e_bike: 165.001 } } as Co2Factors,
      meta
    );
    expect(result.ok && result.factorSet.manufacturingNewGrams).toEqual({ e_bike: 165_001 });
  });

  it('rejects a factor finer than a gram instead of rounding it', () => {
    expect(
      buildFactorSet({ ...factors, manufacturing_new_kg: { e_bike: 165.0004 } } as Co2Factors, meta)
    ).toEqual({ ok: false, reason: 'invalid_factor', field: 'e_bike' });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects a %s footprint', (kg) => {
    const result = buildFactorSet(
      { ...factors, manufacturing_new_kg: { laptop: kg } } as Co2Factors,
      meta
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_factor', field: 'laptop' });
  });

  it.each([1.5, -0.1, 0.1234567])('rejects refurbishment share %s', (share) => {
    expect(buildFactorSet({ ...factors, refurbishment_share_of_new: share }, meta)).toEqual({
      ok: false,
      reason: 'invalid_factor',
      field: 'refurbishment_share_of_new',
    });
  });

  it('accepts the share limits 0 and 1', () => {
    for (const share of [0, 1]) {
      const result = buildFactorSet({ ...factors, refurbishment_share_of_new: share }, meta);
      expect(result.ok && result.factorSet.refurbishmentShareOfNewPpm).toBe(share * 1_000_000);
    }
  });

  it('rejects an invalid car-displacement factor', () => {
    expect(buildFactorSet({ ...factors, e_bike_avoided_car_km_kg_per_km: -1 }, meta)).toEqual({
      ok: false,
      reason: 'invalid_factor',
      field: 'e_bike_avoided_car_km_kg_per_km',
    });
  });

  it('leaves a category without a factor out instead of inventing one', () => {
    const result = buildFactorSet(
      { ...factors, manufacturing_new_kg: { laptop: 330 } } as Co2Factors,
      meta
    );
    expect(result.ok && result.factorSet.manufacturingNewGrams).toEqual({ laptop: 330_000 });
  });
});
