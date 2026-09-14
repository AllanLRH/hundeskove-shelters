import { describe, expect, it } from "vitest";

import { confidenceOf } from "../../src/domain/facility";
import { defaultFilters, type Filters } from "../../src/domain/filters";
import { nightIndex } from "../../src/domain/night";
import {
  findCalendarMatches,
  findMatches,
  splitByBookability,
  tallyNights,
} from "../../src/domain/search";
import { TravelTimes } from "../../src/domain/travel";
import { A_FRIDAY, A_TUESDAY, testDataset } from "../fixtures/dataset";

const dataset = testDataset();
const ids = (matches: { facility: { id: string } }[]) => matches.map((m) => m.facility.id);

/** Filters with nothing narrowed, so a test can widen from a known baseline. */
function allOf(overrides: Partial<Filters> = {}): Filters {
  const filters = defaultFilters(dataset);
  filters.nights = new Set([0, 1, 2, 3, 4, 5, 6]);
  filters.confidence = new Set([
    "inside", "inside_osm", "overlapping", "near", "marker_only",
  ]);
  filters.facilityTypes = new Set(dataset.facilities.map((f) => f.type));
  return { ...filters, ...overrides };
}

describe("defaults", () => {
  it("opens on the weekend", () => {
    const filters = defaultFilters(dataset);
    expect([...filters.nights].sort()).toEqual([4, 5]);
  });

  it("opens on shelters only", () => {
    expect([...defaultFilters(dataset).facilityTypes]).toEqual(["Shelter"]);
  });

  it("leaves the two weakest certainty tiers off", () => {
    const { confidence } = defaultFilters(dataset);
    expect(confidence.has("near")).toBe(false);
    expect(confidence.has("marker_only")).toBe(false);
    expect(confidence.has("inside")).toBe(true);
  });

  it("falls back to every type when a dataset has no shelters", () => {
    // A run with `--categories 1111` must not open on an empty page.
    const noShelters = testDataset(
      dataset.facilities.filter((f) => f.type !== "Shelter"),
    );
    expect([...defaultFilters(noShelters).facilityTypes]).toEqual([
      "Frit teltningsområde",
    ]);
  });
});

describe("availability is not a boolean", () => {
  it("a first-come place is free every night in the horizon", () => {
    const matches = findMatches(dataset, allOf());
    const open = matches.find((m) => m.facility.id === "inside-open")!;
    expect(open.nights).toHaveLength(dataset.nights.length);
  });

  it("a bookable place is free only on its own nights", () => {
    const matches = findMatches(dataset, allOf());
    const bookable = matches.find((m) => m.facility.id === "inside-bookable")!;
    expect([...bookable.nights].sort()).toEqual([A_TUESDAY, A_FRIDAY, "2026-09-12"].sort());
  });

  it("filtering to bookable-only excludes the ones with no calendar", () => {
    const matches = findMatches(dataset, allOf({ availability: new Set(["bookable"]) }));
    expect(ids(matches)).toEqual(["inside-bookable"]);
  });
});

describe("confidence tiers", () => {
  it("classifies each fixture facility as intended", () => {
    const byId = Object.fromEntries(
      dataset.facilities.map((f) => [f.id, confidenceOf(f.proximity)]),
    );
    expect(byId).toMatchObject({
      "inside-bookable": "inside",
      "overlapping-area": "overlapping",
      near: "near",
      "marker-only": "marker_only",
    });
  });

  it("never calls a facility inside a forest that has no outline", () => {
    for (const facility of dataset.facilities) {
      if (!facility.proximity.forest.hasBoundary) {
        expect(facility.proximity.insidePolygon).toBe(false);
      }
    }
  });
});

describe("the calendar ignores Nights and Dates, but not the rest", () => {
  it("the list is weekend-only under the defaults", () => {
    const matches = findMatches(dataset, defaultFilters(dataset));
    for (const match of matches) {
      for (const night of match.nights) {
        expect([4, 5]).toContain(nightIndex(night));
      }
    }
  });

  it("the calendar still sees midweek nights the list has filtered away", () => {
    const calendar = findCalendarMatches(dataset, defaultFilters(dataset));
    const midweek = calendar.some((m) =>
      m.nights.some((night) => ![4, 5].includes(nightIndex(night))),
    );
    expect(midweek).toBe(true);
  });

  it("a narrowed date range bites on the list but not the calendar", () => {
    const filters = allOf({ from: "2026-09-07", to: "2026-09-09" });
    const list = findMatches(dataset, filters);
    const calendar = findCalendarMatches(dataset, filters);
    expect(list.every((m) => m.nights.every((n) => n <= "2026-09-09"))).toBe(true);
    expect(calendar.some((m) => m.nights.some((n) => n > "2026-09-09"))).toBe(true);
  });

  it("the calendar still honours facility type", () => {
    const filters = allOf({ facilityTypes: new Set(["Shelter"]) });
    for (const match of findCalendarMatches(dataset, filters)) {
      expect(match.facility.type).toBe("Shelter");
    }
  });
});

describe("picking one night", () => {
  it("narrows every match to that night alone", () => {
    const matches = findMatches(dataset, allOf({ night: A_FRIDAY }));
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) expect(match.nights).toEqual([A_FRIDAY]);
  });

  it("splits into what must be booked and what need not be, losing nothing", () => {
    const matches = findCalendarMatches(dataset, allOf({ night: A_FRIDAY }));
    const { bookable, others } = splitByBookability(matches);
    expect(bookable.length + others.length).toBe(matches.length);
    expect(ids(bookable)).toEqual(["inside-bookable"]);
  });
});

describe("tallyNights", () => {
  it("counts bookable and first-come apart", () => {
    // A single total would be dominated by the near-constant first-come figure.
    const tally = tallyNights(dataset, allOf());
    expect(tally.get(A_FRIDAY)).toEqual({ bookable: 1, open: 5 });
  });

  it("reports a night with nothing bookable as zero, not as missing", () => {
    const tally = tallyNights(dataset, allOf());
    expect(tally.get("2026-09-14")!.bookable).toBe(0);
  });

  it("covers every night in the horizon", () => {
    const tally = tallyNights(dataset, allOf());
    expect(tally.size).toBe(dataset.nights.length);
  });

  it("respects drive time, so a cell agrees with the detail it opens", () => {
    const times = TravelTimes.fromSeconds([["inside-bookable", 600]]);
    const tally = tallyNights(dataset, allOf({ maxDriveMinutes: 30 }), times);
    // Only the one routed facility survives the limit.
    expect(tally.get(A_FRIDAY)).toEqual({ bookable: 1, open: 0 });
  });
});
