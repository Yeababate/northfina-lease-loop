// Distances for the nearby-dealer map (issue #73). Pure maths on latitude/longitude in
// degrees; no I/O. Locations are coarse on purpose (0.1°, see data/dealer-locations.json),
// so every distance is an estimate and is shown rounded (see roundDistanceKm).

export type LatLon = { lat: number; lon: number };

/** Mean Earth radius (IUGG), in km. Accurate to well under 1 % for these distances. */
export const EARTH_RADIUS_KM = 6371.0088;

/** Throws a RangeError unless lat is in [-90, 90] and lon in [-180, 180] (both finite). */
export function assertValidLatLon(point: LatLon): void {
  const { lat, lon } = point;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`latitude must be between -90 and 90, got ${lat}`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError(`longitude must be between -180 and 180, got ${lon}`);
  }
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in km (haversine formula). Same point → 0. The inner term is clamped
 * to [0, 1] so floating-point noise near antipodal points cannot produce NaN.
 */
export function haversineKm(a: LatLon, b: LatLon): number {
  assertValidLatLon(a);
  assertValidLatLon(b);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(clamped));
}

/**
 * Rounds a coordinate to 0.1°, half away from zero: 24.95 → 25.0, -24.95 → -25.0. The value
 * is first cleaned to 9 significant digits so binary noise (24.95 × 10 = 249.49999…) does not
 * flip the half. Never returns -0.
 */
export function roundCoordinate(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    throw new RangeError(`coordinate must be a finite number, got ${degrees}`);
  }
  const tenths = Number((Math.abs(degrees) * 10).toPrecision(9));
  const rounded = (Math.sign(degrees) * Math.round(tenths)) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** A point rounded to 0.1° on both axes, so an exact location never leaves this function. */
export function coarsen(point: LatLon): LatLon {
  assertValidLatLon(point);
  return { lat: roundCoordinate(point.lat), lon: roundCoordinate(point.lon) };
}

/** Distances are shown in steps of this many km. */
export const DISTANCE_STEP_KM = 5;

/**
 * The distance to show: rounded to the nearest 5 km, half up (2.5 → 5, 157.4 → 155). The
 * coordinates are only good to about ±5–11 km, so finer steps would claim false precision.
 * 0 means "in your area" (both points in the same 0.1° cell, or within 2.5 km).
 */
export function roundDistanceKm(km: number): number {
  if (!Number.isFinite(km) || km < 0) {
    throw new RangeError(`distance must be a non-negative finite number, got ${km}`);
  }
  return Math.floor(km / DISTANCE_STEP_KM + 0.5) * DISTANCE_STEP_KM;
}

export type WithDistance<T> = T & { distanceKm: number; shownDistanceKm: number };

/**
 * Locations sorted nearest first from `home`, each with its exact estimate and its shown
 * (rounded) distance. Sorting uses the unrounded distance; equal distances keep their input
 * order (stable). `limit` keeps the first n; omitted or larger than the list keeps all.
 */
export function nearestFirst<T extends LatLon>(
  home: LatLon,
  locations: readonly T[],
  limit?: number
): WithDistance<T>[] {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError(`limit must be a non-negative integer, got ${limit}`);
  }
  const sorted = locations
    .map((location, index) => ({ location, index, km: haversineKm(home, location) }))
    .sort((a, b) => a.km - b.km || a.index - b.index)
    .map(({ location, km }) => ({
      ...location,
      distanceKm: km,
      shownDistanceKm: roundDistanceKm(km),
    }));
  return limit === undefined ? sorted : sorted.slice(0, limit);
}
