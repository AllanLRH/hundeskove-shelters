import { describe, expect, it } from "vitest";

import { defaultFilters, type Filters } from "../../src/domain/filters";
import { findMatches } from "../../src/domain/search";
import { formatDuration, TravelTimes } from "../../src/domain/travel";
import { testDataset } from "../fixtures/dataset";

const dataset = testDataset();
const ids = (matches: { facility: { id: string } }[]) => matches.map((m) => m.facility.id);

function allOf(overrides: Partial<Filters> = {}): Filters {
  const filters = defaultFilters(dataset);
  filters.nights = new Set([0, 1, 2, 3, 4, 5, 6]);
  filters.confidence = new Set(["inside", "inside_osm", "overlapping", "near", "marker_only"]);
  filters.facilityTypes = new Set(dataset.facilities.map((f) => f.type));
  return { ...filters, ...overrides };
}

/** 20 min, 45 min, and one well beyond an hour. One facility is left unrouted. */
const times = TravelTimes.fromSeconds([
  ["inside-bookable", 20 * 60],
  ["inside-open", 45 * 60],
  ["near", 200 * 60],
]);

describe("formatDuration", () => {
  it("reads as minutes under an hour", () => {
    expect(formatDuration(38 * 60)).toBe("38 min");
  });

  it("drops the minutes when there are none", () => {
    expect(formatDuration(7200)).toBe("2 h");
  });

  it("reads as hours and minutes above an hour", () => {
    expect(formatDuration(4320)).toBe("1 h 12 min");
  });
});

describe("TravelTimes", () => {
  it("is not 'known' until something has been looked up", () => {
    // The distinction that stops an in-flight request blanking the list.
    expect(TravelTimes.empty().known).toBe(false);
    expect(times.known).toBe(true);
  });

  it("prunes to surviving facilities", () => {
    const kept = times.retaining(new Set(["inside-bookable"]));
    expect(kept.size).toBe(1);
    expect(kept.get("inside-open")).toBeUndefined();
  });
});

describe("filtering by drive time", () => {
  it("keeps only what is inside the limit", () => {
    const matches = findMatches(dataset, allOf({ maxDriveMinutes: 60 }), times);
    expect(ids(matches).sort()).toEqual(["inside-bookable", "inside-open"]);
  });

  it("excludes facilities the router could not reach", () => {
    // "We do not know how far" is not "within the limit".
    const matches = findMatches(dataset, allOf({ maxDriveMinutes: 300 }), times);
    expect(ids(matches)).not.toContain("marker-only");
  });

  it("does nothing at all while no lookup has happened", () => {
    // Otherwise the list would empty out mid-request.
    const unlimited = findMatches(dataset, allOf(), TravelTimes.empty());
    const withLimit = findMatches(
      dataset,
      allOf({ maxDriveMinutes: 1 }),
      TravelTimes.empty(),
    );
    expect(withLimit.length).toBe(unlimited.length);
  });
});

describe("sorting nearest first", () => {
  it("orders by driving time ascending", () => {
    const matches = findMatches(dataset, allOf({ sortBy: "drive" }), times);
    expect(ids(matches).slice(0, 3)).toEqual(["inside-bookable", "inside-open", "near"]);
  });

  it("sorts unroutable facilities last, not first", () => {
    // Comparing a bare `undefined` would have floated them to the top.
    const matches = findMatches(dataset, allOf({ sortBy: "drive" }), times);
    const unrouted = ids(matches).indexOf("marker-only");
    expect(unrouted).toBe(matches.length - 1);
  });

  it("falls back to confidence order when nothing has been looked up", () => {
    const byDrive = findMatches(dataset, allOf({ sortBy: "drive" }), TravelTimes.empty());
    const byConfidence = findMatches(dataset, allOf(), TravelTimes.empty());
    expect(ids(byDrive)).toEqual(ids(byConfidence));
  });
});
