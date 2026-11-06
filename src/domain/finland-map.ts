// The schematic map of Finland for the nearby-dealer page (issue #73). No tiles and no map
// library: a hand-simplified outline in latitude/longitude and a simple projection to SVG
// coordinates, so the demo works offline and adds no dependency.
import { assertValidLatLon, type LatLon } from './geo';

export type MapBounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };

/** Mainland Finland plus a little sea, so Tallinn (59.4° N) also fits on the map. */
export const FINLAND_BOUNDS: MapBounds = { minLat: 59.2, maxLat: 70.2, minLon: 20.3, maxLon: 31.8 };

/**
 * A rough outline of mainland Finland (about 40 points, clockwise from Hanko). Accurate to
 * tens of kilometres: enough to recognise the country, not for navigation.
 */
export const FINLAND_OUTLINE: readonly LatLon[] = [
  { lat: 59.8, lon: 22.9 }, // Hanko
  { lat: 60.1, lon: 24.0 },
  { lat: 60.15, lon: 25.0 }, // Helsinki
  { lat: 60.35, lon: 26.0 },
  { lat: 60.45, lon: 26.9 }, // Kotka
  { lat: 60.55, lon: 27.8 }, // Vaalimaa, the eastern border starts
  { lat: 61.2, lon: 28.9 }, // Imatra
  { lat: 61.6, lon: 29.6 },
  { lat: 62.2, lon: 30.6 },
  { lat: 62.9, lon: 31.5 }, // Ilomantsi, the easternmost point
  { lat: 63.5, lon: 30.6 },
  { lat: 64.2, lon: 30.0 },
  { lat: 64.9, lon: 29.7 },
  { lat: 65.7, lon: 29.9 },
  { lat: 66.8, lon: 29.1 }, // Salla
  { lat: 67.7, lon: 29.9 },
  { lat: 68.2, lon: 28.6 },
  { lat: 68.9, lon: 28.4 },
  { lat: 69.2, lon: 29.2 },
  { lat: 69.7, lon: 29.0 },
  { lat: 70.05, lon: 28.0 }, // Nuorgam, the northernmost point
  { lat: 69.85, lon: 27.0 },
  { lat: 69.45, lon: 25.9 }, // Karigasniemi
  { lat: 68.9, lon: 25.2 },
  { lat: 68.6, lon: 24.0 },
  { lat: 68.8, lon: 22.4 },
  { lat: 69.25, lon: 21.3 }, // Halti
  { lat: 69.05, lon: 20.6 }, // Kilpisjärvi
  { lat: 68.45, lon: 22.3 },
  { lat: 67.9, lon: 23.6 },
  { lat: 66.8, lon: 23.9 }, // Pello
  { lat: 65.85, lon: 24.15 }, // Tornio
  { lat: 65.7, lon: 24.6 }, // Kemi
  { lat: 65.0, lon: 25.4 }, // Oulu
  { lat: 64.7, lon: 24.5 }, // Raahe
  { lat: 63.85, lon: 23.1 }, // Kokkola
  { lat: 63.1, lon: 21.6 }, // Vaasa
  { lat: 62.3, lon: 21.3 },
  { lat: 61.5, lon: 21.5 }, // Pori
  { lat: 61.1, lon: 21.4 }, // Rauma
  { lat: 60.8, lon: 21.3 },
  { lat: 60.25, lon: 21.9 }, // Turku archipelago
];

export type MapSize = { width: number; height: number };

function assertValidBounds(bounds: MapBounds): void {
  assertValidLatLon({ lat: bounds.minLat, lon: bounds.minLon });
  assertValidLatLon({ lat: bounds.maxLat, lon: bounds.maxLon });
  if (bounds.minLat >= bounds.maxLat || bounds.minLon >= bounds.maxLon) {
    throw new RangeError('map bounds must have min below max on both axes');
  }
}

/**
 * The SVG size for a map `width` units wide. Equirectangular projection: one degree of
 * longitude is shortened by cos(middle latitude), so Finland keeps its real proportions.
 */
export function mapSize(bounds: MapBounds, width: number): MapSize {
  assertValidBounds(bounds);
  if (!Number.isFinite(width) || width <= 0) {
    throw new RangeError(`width must be a positive number, got ${width}`);
  }
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const scaledLonSpan = (bounds.maxLon - bounds.minLon) * Math.cos((midLat * Math.PI) / 180);
  return { width, height: (width * (bounds.maxLat - bounds.minLat)) / scaledLonSpan };
}

/**
 * Projects a point to SVG x/y (y grows downwards): the north-west corner of `bounds` is
 * (0, 0), the south-east corner is (width, height). Points outside the bounds are not
 * clamped, so they land outside the drawing; callers decide whether to show them.
 */
export function projectToSvg(
  point: LatLon,
  bounds: MapBounds,
  width: number
): { x: number; y: number } {
  assertValidLatLon(point);
  const size = mapSize(bounds, width);
  return {
    x: ((point.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * size.width,
    y: ((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat)) * size.height,
  };
}

/** True when the point is inside the bounds (edges included). */
export function isInsideBounds(point: LatLon, bounds: MapBounds): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lon >= bounds.minLon &&
    point.lon <= bounds.maxLon
  );
}

/** A closed SVG path (`M x y L … Z`) for an outline, coordinates rounded to 0.1 unit. */
export function outlinePath(outline: readonly LatLon[], bounds: MapBounds, width: number): string {
  if (outline.length < 3) throw new RangeError('an outline needs at least 3 points');
  const parts = outline.map((point, index) => {
    const { x, y } = projectToSvg(point, bounds, width);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `${parts.join(' ')} Z`;
}
