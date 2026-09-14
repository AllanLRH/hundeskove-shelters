import { describe, expect, it, vi } from "vitest";

import { TravelTimes, type Origin } from "../../src/domain/travel";
import type { Geocoder } from "../../src/io/geocoding";
import type { Destination, Router } from "../../src/io/routing";
import { initialState, travelStarted } from "../../src/app/state";
import { lookUpTravel, type TravelDeps } from "../../src/app/lookUpTravel";
import { testDataset } from "../fixtures/dataset";

const dataset = testDataset();
const ORIGIN: Origin = { lat: 55.6761, lon: 12.5683, label: "Rådhuspladsen 1, København" };

function deps(overrides: Partial<TravelDeps> = {}): TravelDeps {
  const geocoder: Geocoder = { lookUp: async () => ORIGIN };
  const router: Router = {
    drivingTimes: async (_origin, destinations: readonly Destination[]) =>
      TravelTimes.fromSeconds(destinations.map((d, i) => [d.id, (i + 1) * 600])),
  };
  return { geocoder, router, ...overrides };
}

describe("looking up driving times", () => {
  it("ends ready, with a time for every routed facility", async () => {
    const state = await lookUpTravel(initialState(dataset), dataset, "Rådhuspladsen", deps());
    expect(state.travel.status).toBe("ready");
    expect(state.travel.origin).toEqual(ORIGIN);
    expect(state.travel.times.size).toBe(dataset.facilities.length);
    expect(state.travel.progress).toBeNull();
  });

  it("routes to every facility, not just the ones currently matching", async () => {
    // Otherwise changing a filter would need another round trip.
    const seen: string[] = [];
    const router: Router = {
      drivingTimes: async (_o, destinations) => {
        seen.push(...destinations.map((d) => d.id));
        return TravelTimes.empty();
      },
    };
    await lookUpTravel(initialState(dataset), dataset, "x", deps({ router }));
    expect(seen).toEqual(dataset.facilities.map((f) => f.id));
  });

  it("publishes progress before the answer arrives", async () => {
    const states = [];
    await lookUpTravel(
      initialState(dataset),
      dataset,
      "Rådhuspladsen",
      deps(),
      (next) => states.push(next.travel.status),
    );
    expect(states[0]).toBe("working");
    expect(states.at(-1)).toBe("ready");
  });

  it("remembers the address it was given", async () => {
    const rememberAddress = vi.fn();
    await lookUpTravel(initialState(dataset), dataset, "  Rådhuspladsen  ", deps({ rememberAddress }));
    expect(rememberAddress).toHaveBeenCalledWith("Rådhuspladsen");
  });

  it("prefers the cache over asking the router again", async () => {
    const drivingTimes = vi.fn();
    const cached = TravelTimes.fromSeconds([["inside-open", 123]]);
    const state = await lookUpTravel(
      initialState(dataset),
      dataset,
      "x",
      deps({ readCache: () => cached, router: { drivingTimes } }),
    );
    expect(drivingTimes).not.toHaveBeenCalled();
    expect(state.travel.times.get("inside-open")).toBe(123);
  });

  it("caches what it fetched", async () => {
    const writeCache = vi.fn();
    await lookUpTravel(initialState(dataset), dataset, "x", deps({ writeCache }));
    expect(writeCache).toHaveBeenCalledWith(ORIGIN, expect.anything());
  });
});

describe("when it goes wrong", () => {
  it("surfaces a geocoding failure as a readable error", async () => {
    const geocoder: Geocoder = {
      lookUp: async () => {
        throw new Error("No Danish address found for “nowhere”.");
      },
    };
    const state = await lookUpTravel(initialState(dataset), dataset, "nowhere", deps({ geocoder }));
    expect(state.travel.status).toBe("error");
    expect(state.travel.error).toContain("No Danish address found");
    expect(state.travel.progress).toBeNull();
  });

  it("surfaces a routing failure without losing the located origin", async () => {
    const router: Router = {
      drivingTimes: async () => {
        throw new Error("Routing failed (429).");
      },
    };
    const state = await lookUpTravel(initialState(dataset), dataset, "x", deps({ router }));
    expect(state.travel.status).toBe("error");
    expect(state.travel.origin).toEqual(ORIGIN);
  });

  it("ignores a blank address", async () => {
    const geocoder = { lookUp: vi.fn() };
    const before = initialState(dataset);
    const after = await lookUpTravel(before, dataset, "   ", deps({ geocoder }));
    expect(after).toBe(before);
    expect(geocoder.lookUp).not.toHaveBeenCalled();
  });

  it("ignores a second submit while one is in flight", async () => {
    // These are donated services; a double-click must not double the load.
    const geocoder = { lookUp: vi.fn() };
    const working = travelStarted(initialState(dataset), "first");
    const after = await lookUpTravel(working, dataset, "second", deps({ geocoder }));
    expect(after).toBe(working);
    expect(geocoder.lookUp).not.toHaveBeenCalled();
  });
});
