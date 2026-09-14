/**
 * The address-to-driving-times flow, with its collaborators injected.
 *
 * Kept apart from the DOM so the whole sequence — geocode, route, cache, the
 * error paths — can be exercised against fakes. It was previously reachable
 * only by typing into a browser.
 */

import type { Dataset } from "../domain/dataset";
import type { TravelTimes } from "../domain/travel";
import type { Geocoder } from "../io/geocoding";
import type { Router } from "../io/routing";
import {
  travelFailed,
  travelLocated,
  travelProgressed,
  travelReady,
  travelStarted,
  destinationsOf,
  type AppState,
} from "./state";

export interface TravelDeps {
  geocoder: Geocoder;
  router: Router;
  /** Driving times already known for this origin, if any. */
  readCache?: (origin: { lat: number; lon: number }) => TravelTimes | null;
  writeCache?: (origin: { lat: number; lon: number }, times: TravelTimes) => void;
  rememberAddress?: (query: string) => void;
}

/**
 * Run the lookup, publishing each step through `emit`.
 *
 * `emit` is called with every intermediate state so a caller can re-render as
 * progress arrives; the final state is also returned for callers that only
 * care about the outcome.
 */
export async function lookUpTravel(
  state: AppState,
  dataset: Dataset,
  query: string,
  deps: TravelDeps,
  emit: (next: AppState) => void = () => {},
): Promise<AppState> {
  const trimmed = query.trim();
  // Nothing to look up, and a second submit while one is in flight would double
  // the load on services that are donated capacity.
  if (!trimmed || state.travel.status === "working") return state;

  let next = travelStarted(state, trimmed);
  deps.rememberAddress?.(trimmed);
  emit(next);

  try {
    const origin = await deps.geocoder.lookUp(trimmed);
    next = travelLocated(next, origin);
    emit(next);

    const cached = deps.readCache?.(origin) ?? null;
    if (cached) return finish(travelReady(next, cached), emit);

    const times = await deps.router.drivingTimes(
      origin,
      destinationsOf(dataset),
      (done, total) => {
        if (total > 1) {
          next = travelProgressed(next, `Calculating driving times… ${done}/${total}`);
          emit(next);
        }
      },
    );
    deps.writeCache?.(origin, times);
    return finish(travelReady(next, times), emit);
  } catch (error) {
    return finish(
      travelFailed(next, error instanceof Error ? error.message : String(error)),
      emit,
    );
  }
}

function finish(state: AppState, emit: (next: AppState) => void): AppState {
  emit(state);
  return state;
}
