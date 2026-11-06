import { describe, expect, it } from 'vitest';
import {
  FINLAND_BOUNDS,
  FINLAND_OUTLINE,
  isInsideBounds,
  mapSize,
  outlinePath,
  projectToSvg,
} from './finland-map';

const bounds = { minLat: 60, maxLat: 70, minLon: 20, maxLon: 30 };

describe('mapSize', () => {
  it('shortens longitude by cos(middle latitude)', () => {
    const size = mapSize(bounds, 100);
    expect(size.width).toBe(100);
    // 10° of latitude over 10° × cos(65°) of longitude.
    expect(size.height).toBeCloseTo(100 / Math.cos((65 * Math.PI) / 180), 9);
  });

  it('makes Finland taller than wide', () => {
    const size = mapSize(FINLAND_BOUNDS, 300);
    expect(size.height).toBeGreaterThan(size.width);
  });

  it('rejects a bad width or bounds', () => {
    expect(() => mapSize(bounds, 0)).toThrow(RangeError);
    expect(() => mapSize(bounds, Number.NaN)).toThrow(RangeError);
    expect(() => mapSize({ ...bounds, minLat: 70 }, 100)).toThrow(RangeError);
    expect(() => mapSize({ ...bounds, maxLon: 10 }, 100)).toThrow(RangeError);
    expect(() => mapSize({ ...bounds, maxLat: 95 }, 100)).toThrow(RangeError);
  });
});

describe('projectToSvg', () => {
  const { height } = mapSize(bounds, 100);

  it('maps the north-west corner to (0, 0) and the south-east corner to (width, height)', () => {
    expect(projectToSvg({ lat: 70, lon: 20 }, bounds, 100)).toEqual({ x: 0, y: 0 });
    const se = projectToSvg({ lat: 60, lon: 30 }, bounds, 100);
    expect(se.x).toBe(100);
    expect(se.y).toBeCloseTo(height, 9);
  });

  it('puts north higher up (smaller y) and east further right', () => {
    const oulu = projectToSvg({ lat: 65.0, lon: 25.5 }, FINLAND_BOUNDS, 300);
    const helsinki = projectToSvg({ lat: 60.2, lon: 24.9 }, FINLAND_BOUNDS, 300);
    const kuopio = projectToSvg({ lat: 62.9, lon: 27.7 }, FINLAND_BOUNDS, 300);
    expect(oulu.y).toBeLessThan(helsinki.y);
    expect(kuopio.x).toBeGreaterThan(helsinki.x);
  });

  it('does not clamp points outside the bounds', () => {
    const stockholm = projectToSvg({ lat: 59.3, lon: 18.1 }, bounds, 100);
    expect(stockholm.x).toBeLessThan(0);
    expect(stockholm.y).toBeGreaterThan(height);
  });

  it('rejects an invalid point', () => {
    expect(() => projectToSvg({ lat: 91, lon: 0 }, bounds, 100)).toThrow(RangeError);
  });
});

describe('isInsideBounds', () => {
  it('includes the edges and excludes points outside', () => {
    expect(isInsideBounds({ lat: 60, lon: 20 }, bounds)).toBe(true);
    expect(isInsideBounds({ lat: 65, lon: 25 }, bounds)).toBe(true);
    expect(isInsideBounds({ lat: 59.9, lon: 25 }, bounds)).toBe(false);
    expect(isInsideBounds({ lat: 65, lon: 30.1 }, bounds)).toBe(false);
  });
});

describe('the Finland outline', () => {
  it('lies entirely inside the map bounds', () => {
    for (const point of FINLAND_OUTLINE) expect(isInsideBounds(point, FINLAND_BOUNDS)).toBe(true);
  });

  it('becomes a closed SVG path', () => {
    const path = outlinePath(FINLAND_OUTLINE, FINLAND_BOUNDS, 300);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);
    expect(path.match(/[ML]/g)).toHaveLength(FINLAND_OUTLINE.length);
  });

  it('rounds path coordinates to one decimal', () => {
    expect(
      outlinePath(
        [
          { lat: 70, lon: 20 },
          { lat: 60, lon: 30 },
          { lat: 60, lon: 20 },
        ],
        bounds,
        100
      )
    ).toMatch(/^M0\.0 0\.0 L100\.0 \d+\.\d L0\.0 \d+\.\d Z$/);
  });

  it('needs at least three points', () => {
    expect(() => outlinePath(FINLAND_OUTLINE.slice(0, 2), FINLAND_BOUNDS, 300)).toThrow(RangeError);
  });
});
