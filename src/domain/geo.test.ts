import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_KM,
  coarsen,
  haversineKm,
  nearestFirst,
  roundCoordinate,
  roundDistanceKm,
} from './geo';

const helsinki = { lat: 60.1699, lon: 24.9384 };
const tampere = { lat: 61.4978, lon: 23.761 };

describe('haversineKm', () => {
  it('is 0 for the same point', () => {
    expect(haversineKm(helsinki, helsinki)).toBe(0);
  });

  it('puts Helsinki and Tampere about 160 km apart, either way round', () => {
    expect(haversineKm(helsinki, tampere)).toBeCloseTo(160, -1);
    expect(haversineKm(helsinki, tampere)).toBeGreaterThan(155);
    expect(haversineKm(helsinki, tampere)).toBeLessThan(165);
    expect(haversineKm(tampere, helsinki)).toBe(haversineKm(helsinki, tampere));
  });

  it('gives half the circumference for antipodal points, without NaN', () => {
    const half = Math.PI * EARTH_RADIUS_KM;
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(half, 6);
    expect(haversineKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(half, 6);
    expect(haversineKm({ lat: 60.2, lon: 24.9 }, { lat: -60.2, lon: -155.1 })).toBeCloseTo(half, 6);
  });

  it('treats -180 and 180 longitude as the same meridian', () => {
    expect(haversineKm({ lat: 10, lon: -180 }, { lat: 10, lon: 180 })).toBeCloseTo(0, 9);
  });

  it('rejects latitudes and longitudes out of range or not finite', () => {
    expect(() => haversineKm({ lat: 90.1, lon: 0 }, helsinki)).toThrow(RangeError);
    expect(() => haversineKm(helsinki, { lat: -91, lon: 0 })).toThrow(RangeError);
    expect(() => haversineKm(helsinki, { lat: 0, lon: 180.5 })).toThrow(RangeError);
    expect(() => haversineKm(helsinki, { lat: 0, lon: -181 })).toThrow(RangeError);
    expect(() => haversineKm(helsinki, { lat: Number.NaN, lon: 0 })).toThrow(RangeError);
    expect(() => haversineKm(helsinki, { lat: 0, lon: Infinity })).toThrow(RangeError);
  });
});

describe('roundCoordinate', () => {
  it('rounds to 0.1°', () => {
    expect(roundCoordinate(60.1699)).toBe(60.2);
    expect(roundCoordinate(24.9384)).toBe(24.9);
    expect(roundCoordinate(23.761)).toBe(23.8);
    expect(roundCoordinate(65)).toBe(65);
  });

  it('rounds halves away from zero despite binary noise', () => {
    expect(roundCoordinate(24.95)).toBe(25);
    expect(roundCoordinate(-24.95)).toBe(-25);
    expect(roundCoordinate(0.05)).toBe(0.1);
    expect(roundCoordinate(1.04999)).toBe(1);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundCoordinate(-0.04), 0)).toBe(true);
    expect(Object.is(roundCoordinate(-0), 0)).toBe(true);
  });

  it('rejects non-finite values', () => {
    expect(() => roundCoordinate(Number.NaN)).toThrow(RangeError);
    expect(() => roundCoordinate(-Infinity)).toThrow(RangeError);
  });
});

describe('coarsen', () => {
  it('rounds both axes and validates the point', () => {
    expect(coarsen(helsinki)).toEqual({ lat: 60.2, lon: 24.9 });
    expect(coarsen({ lat: 89.99, lon: -179.99 })).toEqual({ lat: 90, lon: -180 });
    expect(() => coarsen({ lat: 100, lon: 0 })).toThrow(RangeError);
  });
});

describe('roundDistanceKm', () => {
  it('rounds to the nearest 5 km, half up', () => {
    expect(roundDistanceKm(0)).toBe(0);
    expect(roundDistanceKm(2.49)).toBe(0);
    expect(roundDistanceKm(2.5)).toBe(5);
    expect(roundDistanceKm(157.4)).toBe(155);
    expect(roundDistanceKm(157.5)).toBe(160);
    expect(roundDistanceKm(20015.1)).toBe(20015);
  });

  it('rejects negative and non-finite distances', () => {
    expect(() => roundDistanceKm(-1)).toThrow(RangeError);
    expect(() => roundDistanceKm(Number.NaN)).toThrow(RangeError);
    expect(() => roundDistanceKm(Infinity)).toThrow(RangeError);
  });
});

describe('nearestFirst', () => {
  const dealers = [
    { id: 'oulu', lat: 65.0, lon: 25.5 },
    { id: 'tampere', lat: 61.5, lon: 23.8 },
    { id: 'helsinki', lat: 60.2, lon: 24.9 },
    { id: 'helsinki-2', lat: 60.2, lon: 24.9 },
  ];
  const home = { lat: 60.2, lon: 24.9 };

  it('sorts nearest first and adds the exact and shown distance', () => {
    const result = nearestFirst(home, dealers);
    expect(result.map((d) => d.id)).toEqual(['helsinki', 'helsinki-2', 'tampere', 'oulu']);
    expect(result[0]).toMatchObject({ id: 'helsinki', distanceKm: 0, shownDistanceKm: 0 });
    expect(result[2]?.shownDistanceKm).toBe(155);
    expect(result[2]?.distanceKm).toBeCloseTo(156.3, 1);
  });

  it('keeps the input order for equal distances (stable ties)', () => {
    const reversed = nearestFirst(home, [dealers[3]!, dealers[2]!]);
    expect(reversed.map((d) => d.id)).toEqual(['helsinki-2', 'helsinki']);
  });

  it('applies the limit and handles empty input', () => {
    expect(nearestFirst(home, dealers, 2).map((d) => d.id)).toEqual(['helsinki', 'helsinki-2']);
    expect(nearestFirst(home, dealers, 0)).toEqual([]);
    expect(nearestFirst(home, dealers, 99)).toHaveLength(4);
    expect(nearestFirst(home, [])).toEqual([]);
  });

  it('does not change the input', () => {
    const copy = structuredClone(dealers);
    nearestFirst(home, dealers);
    expect(dealers).toEqual(copy);
  });

  it('rejects a bad limit or a bad home', () => {
    expect(() => nearestFirst(home, dealers, -1)).toThrow(RangeError);
    expect(() => nearestFirst(home, dealers, 1.5)).toThrow(RangeError);
    expect(() => nearestFirst({ lat: 95, lon: 0 }, dealers)).toThrow(RangeError);
  });
});
