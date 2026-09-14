import { describe, expect, it } from "vitest";

import { parseDataset, parseFacility, type WireFacility } from "../../src/io/wire";

/** A row exactly as `output/availability.json` writes one. */
function wireRow(overrides: Partial<WireFacility> = {}): WireFacility {
  return {
    shelter_id: "guid-1",
    name: "Test shelter",
    facility_type: "Shelter",
    umb_id: 1115,
    description: "A shelter",
    dog_forest_name: "Test hundeskov",
    dog_forest_id: "forest-1",
    distance_m: 0,
    inside_polygon: true,
    overlap_fraction: null,
    dog_forest_has_boundary: true,
    geofence_source: "fkg",
    commune_code: 101,
    region: 84,
    org: "Naturstyrelsen Test",
    bookable: true,
    place_id: 42,
    booking_status: "naturstyrelsen",
    booking_url: "https://book.naturstyrelsen.dk/sted/?id=guid-1",
    lat: 55.9,
    lon: 12.5,
    n_available: 2,
    available_dates: ["2026-09-11", "2026-09-12"],
    ...overrides,
  };
}

describe("parseFacility", () => {
  it("renames the wire fields into domain ones", () => {
    const facility = parseFacility(wireRow());
    expect(facility.id).toBe("guid-1");
    expect(facility.type).toBe("Shelter");
    expect(facility.categoryId).toBe(1115);
    expect(facility.position).toEqual({ lat: 55.9, lon: 12.5 });
    expect(facility.operator).toBe("Naturstyrelsen Test");
  });

  it("gathers the three dog-forest fields into one proximity", () => {
    const { proximity } = parseFacility(wireRow());
    expect(proximity.forest).toEqual({
      id: "forest-1",
      name: "Test hundeskov",
      hasBoundary: true,
      source: "fkg",
    });
    expect(proximity.insidePolygon).toBe(true);
    expect(proximity.distanceM).toBe(0);
  });

  it("reads a Naturstyrelsen row as bookable, with its real nights", () => {
    const availability = parseFacility(wireRow()).availability;
    expect(availability.kind).toBe("bookable");
    expect(availability).toMatchObject({ freeNights: ["2026-09-11", "2026-09-12"] });
  });

  it("reads a not_bookable row as open, not as having no nights", () => {
    // The subtlest rule in the project: no calendar is not "never free".
    const availability = parseFacility(
      wireRow({ booking_status: "not_bookable", place_id: null, available_dates: [] }),
    ).availability;
    expect(availability.kind).toBe("open");
  });

  it("reads an other_operator row as unknown", () => {
    const availability = parseFacility(
      wireRow({ booking_status: "other_operator", place_id: null, available_dates: [] }),
    ).availability;
    expect(availability.kind).toBe("unknown");
  });

  it("keeps an area facility's overlap", () => {
    const { proximity } = parseFacility(
      wireRow({ inside_polygon: false, overlap_fraction: 0.42 }),
    );
    expect(proximity.overlapFraction).toBe(0.42);
    expect(proximity.insidePolygon).toBe(false);
  });
});

describe("parseDataset", () => {
  it("derives the horizon's nights from its ends", () => {
    const dataset = parseDataset({
      checked_at: "2026-09-07T08:00:00+00:00",
      horizon_start: "2026-09-07",
      horizon_end: "2026-09-09",
      shelters: [wireRow()],
    });
    expect(dataset.nights).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(dataset.horizon).toEqual({ start: "2026-09-07", end: "2026-09-09" });
    expect(dataset.checkedAt).toBe("2026-09-07T08:00:00+00:00");
  });

  it("survives having no dog-forest outlines", () => {
    const dataset = parseDataset({
      checked_at: "2026-09-07T08:00:00+00:00",
      horizon_start: "2026-09-07",
      horizon_end: "2026-09-07",
      shelters: [],
    });
    expect(dataset.forests).toBeNull();
  });
});
