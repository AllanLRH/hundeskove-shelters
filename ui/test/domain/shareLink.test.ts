import { describe, expect, it } from "vitest";

import { defaultFilters } from "../../src/domain/filters";
import { fromHash, toHash } from "../../src/domain/shareLink";
import { testDataset } from "../fixtures/dataset";

const dataset = testDataset();

describe("share links", () => {
  it("round-trips the filters that matter", () => {
    const filters = defaultFilters(dataset);
    filters.maxDistanceM = 120;
    filters.nights = new Set([0, 4]);
    filters.night = "2026-09-11";
    filters.maxDriveMinutes = 90;
    filters.sortBy = "drive";

    const restored = fromHash(`#${toHash(filters, dataset)}`, dataset);
    expect(restored.maxDistanceM).toBe(120);
    expect([...restored.nights].sort()).toEqual([0, 4]);
    expect(restored.night).toBe("2026-09-11");
    expect(restored.maxDriveMinutes).toBe(90);
    expect(restored.sortBy).toBe("drive");
  });

  it("survives every facility type being selected", () => {
    // Omitting the parameter in this case used to be safe, back when the
    // default was "all types"; with shelters-only it silently narrowed.
    const filters = defaultFilters(dataset);
    filters.facilityTypes = new Set(dataset.facilities.map((f) => f.type));
    const restored = fromHash(`#${toHash(filters, dataset)}`, dataset);
    expect(restored.facilityTypes.size).toBe(filters.facilityTypes.size);
  });

  it("never carries the home address or a coordinate", () => {
    // A shared link must not hand the sender's home to whoever opens it.
    const filters = defaultFilters(dataset);
    filters.maxDriveMinutes = 30;
    filters.sortBy = "drive";
    const hash = toHash(filters, dataset);
    expect(hash).toContain("drive=30");
    expect(hash).toMatch(/sort=drive/);
    expect(hash).not.toMatch(/address|lat|lon|origin/i);
  });

  it("an empty hash is just the defaults", () => {
    expect(fromHash("", dataset)).toEqual(defaultFilters(dataset));
  });

  it("ignores junk in the night parameter rather than throwing", () => {
    expect(fromHash("#n=x9", dataset).nights.size).toBe(0);
  });
});
