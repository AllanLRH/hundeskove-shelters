/**
 * Remembering driving times for an origin, for the length of the session.
 *
 * OSRM is donated capacity; changing a filter or reloading the page should not
 * re-ask for an answer we already have.
 */

import { TravelTimes, type Origin } from "../domain/travel";
import { DRIVE_CACHE_PREFIX, sessionStore, type Storage } from "./storage";

/** ~11 m of precision — far finer than driving times resolve, and stable when
 *  the geocoder returns marginally different coordinates for the same address. */
function keyFor(origin: Origin): string {
  return `${DRIVE_CACHE_PREFIX}${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}`;
}

export function readDriveCache(
  origin: Origin,
  store: Storage = sessionStore,
): TravelTimes | null {
  const raw = store.get(keyFor(origin));
  if (!raw) return null;
  try {
    return TravelTimes.fromSeconds(
      Object.entries(JSON.parse(raw) as Record<string, number>),
    );
  } catch {
    return null;
  }
}

export function writeDriveCache(
  origin: Origin,
  times: TravelTimes,
  store: Storage = sessionStore,
): void {
  store.set(keyFor(origin), JSON.stringify(Object.fromEntries(times.entries())));
}
