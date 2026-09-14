/** What the user has narrowed the search to. Pure data plus pure predicates. */

import {
  CONFIDENCE_ORDER,
  confidenceOf,
  type AvailabilityKind,
  type Confidence,
  type Facility,
} from "./facility";
import { WEEKEND_NIGHTS, type Night, type NightIndex } from "./night";
import type { Dataset } from "./dataset";
import type { TravelTimes } from "./travel";

/** Nearest-first only means anything once an address has been entered. */
export type SortBy = "confidence" | "drive";

export interface Filters {
  nights: Set<NightIndex>;
  availability: Set<AvailabilityKind>;
  confidence: Set<Confidence>;
  facilityTypes: Set<string>;
  maxDistanceM: number;
  minOverlap: number;
  from: Night;
  to: Night;
  /** Set when a calendar night is clicked, narrowing every view to it. */
  night: Night | null;
  /** Driving minutes from the user's address; null means no limit. */
  maxDriveMinutes: number | null;
  sortBy: SortBy;
}

export const MAX_DISTANCE_M = 500;

/**
 * Tiers shown before you ask for more.
 *
 * `near` and `marker_only` are both weaker claims than they sound: the first is
 * merely close to a dog forest rather than in one, the second has no mapped
 * boundary at all. Opening with only the places actually *in* a forest keeps
 * the default answer trustworthy; both are one checkbox away.
 */
const DEFAULT_CONFIDENCE = CONFIDENCE_ORDER.filter(
  (tier) => tier !== "near" && tier !== "marker_only",
);

/** Shelters are what people usually mean; the other categories opt in. */
const DEFAULT_FACILITY_TYPES = ["Shelter"];

export function defaultFilters(dataset: Dataset): Filters {
  const available = new Set(dataset.facilities.map((f) => f.type));
  const types = DEFAULT_FACILITY_TYPES.filter((type) => available.has(type));
  return {
    // The common question is "where can we go this weekend?".
    nights: new Set(WEEKEND_NIGHTS),
    availability: new Set<AvailabilityKind>(["bookable", "open", "unknown"]),
    confidence: new Set(DEFAULT_CONFIDENCE),
    // Fall back to everything when a dataset has no shelters at all, so a run
    // with `--categories 1111` is not silently empty on first load.
    facilityTypes: new Set(types.length > 0 ? types : available),
    maxDistanceM: MAX_DISTANCE_M,
    minOverlap: 0,
    from: dataset.horizon.start,
    to: dataset.horizon.end,
    night: null,
    maxDriveMinutes: null,
    sortBy: "confidence",
  };
}

/**
 * Everything except the question of *when*: availability kind, certainty,
 * category, proximity and driving time.
 */
export function matchesAttributes(
  facility: Facility,
  filters: Filters,
  travel: TravelTimes,
): boolean {
  if (!filters.availability.has(facility.availability.kind)) return false;
  if (!filters.confidence.has(confidenceOf(facility.proximity))) return false;
  if (!filters.facilityTypes.has(facility.type)) return false;
  if (facility.proximity.distanceM > filters.maxDistanceM) return false;
  if (filters.minOverlap > 0) {
    if ((facility.proximity.overlapFraction ?? 0) < filters.minOverlap) return false;
  }
  if (filters.maxDriveMinutes !== null && travel.known) {
    const seconds = travel.get(facility.id);
    // Missing means the router found no way there. With a limit set, "we do not
    // know" is not "within the limit", so it is excluded — but only once there
    // is a result to judge against, which is why `travel.known` guards it. An
    // unguarded check would blank the list while the request is still running.
    if (seconds === undefined || seconds > filters.maxDriveMinutes * 60) return false;
  }
  return true;
}

/** Whether a night survives the night-of-week, date-range and picked-night filters. */
export function matchesNight(
  night: Night,
  index: NightIndex,
  filters: Filters,
  { respectNightAndRange = true } = {},
): boolean {
  if (respectNightAndRange) {
    if (night < filters.from || night > filters.to) return false;
    if (!filters.nights.has(index)) return false;
  }
  if (filters.night !== null && night !== filters.night) return false;
  return true;
}
