import { describe, expect, it } from "vitest";

import { defaultFilters } from "../../src/domain/filters";
import { TravelTimes } from "../../src/domain/travel";
import { MutableDatasetSource } from "../../src/io/datasetSource";
import {
  adoptDataset,
  clearTravel,
  deriveViewModel,
  initialState,
  pickNight,
  selectFacility,
  travelReady,
  updateOffered,
  withFilters,
} from "../../src/app/state";
import { A_FRIDAY, refreshedDataset, testDataset } from "../fixtures/dataset";

const dataset = testDataset();

describe("the view model", () => {
  it("says how many of the total matched", () => {
    const vm = deriveViewModel(dataset, initialState(dataset));
    expect(vm.status).toContain(`of ${dataset.facilities.length} places match`);
  });

  it("mentions the picked night in the status line", () => {
    const state = pickNight(initialState(dataset), A_FRIDAY);
    expect(deriveViewModel(dataset, state).status).toContain(A_FRIDAY);
  });

  it("offers a night detail only once a night is picked", () => {
    expect(deriveViewModel(dataset, initialState(dataset)).nightDetail).toBeNull();
    const picked = pickNight(initialState(dataset), A_FRIDAY);
    expect(deriveViewModel(dataset, picked).nightDetail?.night).toBe(A_FRIDAY);
  });

  it("resolves a selection to the matching result", () => {
    const state = selectFacility(initialState(dataset), "inside-open");
    expect(deriveViewModel(dataset, state).selected?.facility.id).toBe("inside-open");
  });

  it("reports no selection when the selected facility is filtered out", () => {
    // Selecting then narrowing past it must not leave a dangling detail panel.
    let state = selectFacility(initialState(dataset), "overlapping-area");
    state = withFilters(state, {
      ...defaultFilters(dataset),
      facilityTypes: new Set(["Shelter"]),
    });
    expect(deriveViewModel(dataset, state).selected).toBeNull();
  });
});

describe("clearing the address", () => {
  it("drops the drive-time limit and the nearest-first sort with it", () => {
    // Both are relative to an origin; left behind they would hide everything.
    let state = initialState(dataset);
    state = withFilters(state, {
      ...state.filters,
      maxDriveMinutes: 30,
      sortBy: "drive",
    });
    state = travelReady(state, TravelTimes.fromSeconds([["inside-open", 60]]));

    const cleared = clearTravel(state);
    expect(cleared.filters.maxDriveMinutes).toBeNull();
    expect(cleared.filters.sortBy).toBe("confidence");
    expect(cleared.travel.times.known).toBe(false);
    expect(cleared.travel.query).toBe("");
  });
});

describe("a dataset refresh", () => {
  it("does not change what is shown until it is adopted", () => {
    const source = new MutableDatasetSource(dataset);
    let notified = 0;
    source.subscribe(() => (notified += 1));

    source.offer(refreshedDataset());

    expect(notified).toBe(1);
    expect(source.pending()).not.toBeNull();
    // The crucial property: the data must not move under the user.
    expect(source.current().dataset).toBe(dataset);
  });

  it("ignores data it already has", () => {
    const source = new MutableDatasetSource(dataset);
    let notified = 0;
    source.subscribe(() => (notified += 1));
    source.offer(testDataset()); // same checked_at, so same revision
    expect(notified).toBe(0);
    expect(source.pending()).toBeNull();
  });

  it("becomes current on adopt", () => {
    const source = new MutableDatasetSource(dataset);
    const next = refreshedDataset();
    source.offer(next);
    expect(source.adopt().dataset).toBe(next);
    expect(source.pending()).toBeNull();
  });

  it("keeps a selection that survived the refresh", () => {
    const state = selectFacility(initialState(dataset), "inside-bookable");
    expect(adoptDataset(state, refreshedDataset()).selectedId).toBe("inside-bookable");
  });

  it("drops a selection whose facility is gone", () => {
    // refreshedDataset() removes inside-open.
    const state = selectFacility(initialState(dataset), "inside-open");
    expect(adoptDataset(state, refreshedDataset()).selectedId).toBeNull();
  });

  it("prunes travel times for departed facilities", () => {
    // They are keyed by facility id, so a stale one would show a drive time
    // for something no longer in the list.
    let state = initialState(dataset);
    state = travelReady(
      state,
      TravelTimes.fromSeconds([
        ["inside-bookable", 600],
        ["inside-open", 900],
      ]),
    );
    const adopted = adoptDataset(state, refreshedDataset());
    expect(adopted.travel.times.get("inside-bookable")).toBe(600);
    expect(adopted.travel.times.get("inside-open")).toBeUndefined();
  });

  it("carries the filters across untouched", () => {
    let state = initialState(dataset);
    state = withFilters(state, { ...state.filters, maxDistanceM: 120 });
    expect(adoptDataset(state, refreshedDataset()).filters.maxDistanceM).toBe(120);
  });

  it("clears the banner once adopted", () => {
    const state = updateOffered(initialState(dataset));
    expect(deriveViewModel(dataset, state).updateAvailable).toBe(true);
    expect(adoptDataset(state, refreshedDataset()).updateAvailable).toBe(false);
  });
});
