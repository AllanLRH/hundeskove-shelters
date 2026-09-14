/**
 * A small, deterministic dataset.
 *
 * Hand-built rather than sliced from `output/`, so assertions stay stable when
 * the real data is refreshed. It covers every case the logic branches on: all
 * three availability kinds, every confidence tier, and both a point facility
 * and an area one.
 *
 * The horizon is a fixed fortnight in September 2026 — 7 Sep is a Monday, which
 * makes the weekday arithmetic in the tests easy to read.
 */

import { makeDataset, type Dataset } from "../../src/domain/dataset";
import type { Availability, Facility, Proximity } from "../../src/domain/facility";

export const HORIZON = { start: "2026-09-07", end: "2026-09-20" } as const;
export const CHECKED_AT = "2026-09-07T08:00:00+00:00";

/** 2026-09-11 is a Friday: the fri–sat night. */
export const A_FRIDAY = "2026-09-11";
/** 2026-09-08 is a Tuesday: a midweek night the weekend default excludes. */
export const A_TUESDAY = "2026-09-08";

function proximity(overrides: Partial<Proximity> = {}): Proximity {
  return {
    forest: {
      id: "forest-1",
      name: "Test hundeskov",
      hasBoundary: true,
      source: "fkg",
      ...(overrides.forest ?? {}),
    },
    distanceM: 0,
    insidePolygon: true,
    overlapFraction: null,
    ...overrides,
  };
}

function facility(id: string, overrides: Partial<Facility> = {}): Facility {
  return {
    id,
    name: `Facility ${id}`,
    type: "Shelter",
    categoryId: 1115,
    description: "",
    position: { lat: 55.9, lon: 12.5 },
    region: 84,
    communeCode: 101,
    operator: "Naturstyrelsen Test",
    proximity: proximity(),
    availability: { kind: "open" } as Availability,
    booking: { url: "https://book.naturstyrelsen.dk/sted/?id=" + id, placeId: null },
    ...overrides,
  };
}

/**
 * Six facilities:
 *   inside-bookable   inside an official boundary, with a real calendar
 *   inside-open       inside, free/first-come
 *   inside-unknown    inside, booked through another system
 *   overlapping-area  an area straddling the boundary
 *   near              close to a boundary but not in it
 *   marker-only       matched against a forest with no outline
 */
export const FACILITIES: Facility[] = [
  facility("inside-bookable", {
    name: "Bookable shelter",
    availability: {
      kind: "bookable",
      // A Friday, a Saturday and a Tuesday, so night filters have something to bite on.
      freeNights: [A_FRIDAY, "2026-09-12", A_TUESDAY],
    },
    booking: { url: "https://book.naturstyrelsen.dk/sted/?id=inside-bookable", placeId: 42 },
  }),
  facility("inside-open", { name: "First-come shelter" }),
  facility("inside-unknown", {
    name: "Municipal shelter",
    availability: { kind: "unknown" },
  }),
  facility("overlapping-area", {
    name: "Free camping area",
    type: "Frit teltningsområde",
    categoryId: 1106,
    proximity: proximity({ insidePolygon: false, distanceM: 0, overlapFraction: 0.4 }),
  }),
  facility("near", {
    name: "Nearby shelter",
    proximity: proximity({ insidePolygon: false, distanceM: 120 }),
  }),
  facility("marker-only", {
    name: "Marker-only shelter",
    proximity: proximity({
      insidePolygon: false,
      distanceM: 200,
      forest: { id: "forest-2", name: "Marker forest", hasBoundary: false, source: "fkg" },
    }),
  }),
];

export function testDataset(facilities: Facility[] = FACILITIES): Dataset {
  return makeDataset(facilities, HORIZON, CHECKED_AT);
}

/** A dataset that looks like a later refresh: newer revision, one facility gone. */
export function refreshedDataset(): Dataset {
  return makeDataset(
    FACILITIES.filter((f) => f.id !== "inside-open"),
    HORIZON,
    "2026-09-08T08:00:00+00:00",
  );
}

export { facility as buildFacility, proximity as buildProximity };
