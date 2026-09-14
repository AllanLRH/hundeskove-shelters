/**
 * A place you can spend the night, and how it relates to a dog forest.
 *
 * "Facility" rather than "shelter": the project covers four udinaturen
 * categories — Shelter, Primitiv overnatningsplads, Lejrplads and Frit
 * teltningsområde — and Primitiv overnatningsplads actually yields more
 * strictly-inside hits than shelters do. The output files still say
 * `shelter_id` for historical reasons; that name stops at `io/wire.ts`.
 */

import type { Night } from "./night";

export interface Coordinates {
  /** WGS84, for map links and rendering. */
  lat: number;
  lon: number;
}

/** How a facility sits relative to the dog forest it matched. */
export interface Proximity {
  forest: DogForestRef;
  /** Metres to the boundary. Zero for a facility inside, and also zero for an
   *  area that merely touches — which is why `insidePolygon` exists too. */
  distanceM: number;
  insidePolygon: boolean;
  /** Share of an *area* facility lying inside. `null` for point facilities,
   *  where containment already says everything. */
  overlapFraction: number | null;
}

export interface DogForestRef {
  id: string;
  name: string;
  /** False for the 129 forests mapped as a bare marker with no outline. A
   *  facility can never be reported inside one, and its distance is measured
   *  to a pin rather than an edge. */
  hasBoundary: boolean;
  /** `fkg` for an official boundary, `osm` for one filled in from OSM. */
  source: "fkg" | "osm";
}

/**
 * How certain we are that a facility is really in an off-leash forest,
 * strongest claim first.
 */
export type Confidence =
  | "inside"
  | "inside_osm"
  | "overlapping"
  | "near"
  | "marker_only";

export const CONFIDENCE_ORDER: readonly Confidence[] = [
  "inside",
  "inside_osm",
  "overlapping",
  "near",
  "marker_only",
] as const;

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  inside: "Inside (official boundary)",
  inside_osm: "Inside (OSM boundary)",
  overlapping: "Overlaps the dog forest",
  near: "Near the boundary",
  marker_only: "Marker only — distance unreliable",
};

/**
 * When a facility is free.
 *
 * A union rather than a status string plus a nullable date list, because the
 * subtlest rule in this project is that **no calendar is not the same as never
 * free**: 244 of 338 facilities need no booking at all and are open every
 * night, while 36 are booked through a system we cannot see. Making those
 * separate shapes means the distinction cannot be dropped by accident.
 */
export type Availability =
  | { kind: "bookable"; freeNights: readonly Night[] }
  | { kind: "open" }
  | { kind: "unknown" };

export type AvailabilityKind = Availability["kind"];

export const AVAILABILITY_LABEL: Record<AvailabilityKind, string> = {
  bookable: "Bookable",
  open: "Free / first-come",
  unknown: "Booked elsewhere",
};

export interface Booking {
  /** Where to reserve it, or read about it when it is not bookable here. */
  url: string;
  /** Naturstyrelsen's numeric place id, when it has one. */
  placeId: number | null;
}

export interface Facility {
  id: string;
  name: string;
  /** The udinaturen category label, e.g. "Shelter". */
  type: string;
  /** The category's umbId, needed to deep-link udinaturen's own map. */
  categoryId: number;
  description: string;
  position: Coordinates;
  /** 81-85. udinaturen's map can only be deep-linked this coarsely. */
  region: number;
  communeCode: number;
  operator: string;
  proximity: Proximity;
  availability: Availability;
  booking: Booking;
}

/** Which confidence tier a facility's proximity earns it. */
export function confidenceOf(proximity: Proximity): Confidence {
  if (proximity.insidePolygon) {
    return proximity.forest.source === "osm" ? "inside_osm" : "inside";
  }
  if ((proximity.overlapFraction ?? 0) > 0) return "overlapping";
  if (!proximity.forest.hasBoundary) return "marker_only";
  return "near";
}

/** How a facility sits relative to its dog forest, in one phrase. */
export function describeProximity(proximity: Proximity): string {
  if (proximity.insidePolygon) return "inside";
  if (proximity.overlapFraction) {
    return `${(proximity.overlapFraction * 100).toFixed(1)}% overlap`;
  }
  const distance = `${Math.round(proximity.distanceM)} m`;
  return proximity.forest.hasBoundary ? distance : `~${distance} to marker`;
}

/** Nights this facility is free within a horizon. Open places are free always. */
export function freeNights(
  availability: Availability,
  horizon: readonly Night[],
): readonly Night[] {
  switch (availability.kind) {
    case "bookable":
      return availability.freeNights;
    case "open":
      // No booking needed, so every night in the horizon is available.
      return horizon;
    case "unknown":
      // Booked elsewhere: we cannot claim any particular night, but the place
      // is still a real destination, so it is offered with the caveat shown.
      return horizon;
  }
}
