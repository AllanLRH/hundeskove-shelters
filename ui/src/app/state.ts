/**
 * What the app is showing, and how it changes.
 *
 * Every transition here is a pure function from state to state, and
 * `deriveViewModel` turns state plus data into exactly what the screen needs.
 * Nothing in this file touches the DOM, `fetch` or storage, which is what makes
 * the interesting behaviour — filtering, selection, adopting refreshed data,
 * the whole address-to-drive-times flow — testable without a browser.
 */

import type { Dataset } from "../domain/dataset";
import { facilityIds } from "../domain/dataset";
import type { Facility } from "../domain/facility";
import { defaultFilters, type Filters } from "../domain/filters";
import type { Night } from "../domain/night";
import {
  findCalendarMatches,
  findMatches,
  splitByBookability,
  tallyNights,
  type Match,
  type NightTally,
} from "../domain/search";
import { TravelTimes, type Origin } from "../domain/travel";

export type ViewName = "list" | "calendar" | "map";

export type TravelStatus = "idle" | "working" | "ready" | "error";

export interface TravelState {
  /** What the user typed, kept so the input survives a re-render. */
  query: string;
  origin: Origin | null;
  times: TravelTimes;
  status: TravelStatus;
  error: string | null;
  /** Progress text while a multi-chunk routing run is in flight. */
  progress: string | null;
}

export interface AppState {
  filters: Filters;
  view: ViewName;
  selectedId: string | null;
  travel: TravelState;
  /** True once a newer dataset is waiting to be adopted. Drives the banner. */
  updateAvailable: boolean;
}

export function initialTravel(query = ""): TravelState {
  return {
    query,
    origin: null,
    times: TravelTimes.empty(),
    status: "idle",
    error: null,
    progress: null,
  };
}

export function initialState(dataset: Dataset, filters?: Filters, query = ""): AppState {
  return {
    filters: filters ?? defaultFilters(dataset),
    view: "list",
    selectedId: null,
    travel: initialTravel(query),
    updateAvailable: false,
  };
}

// --- transitions ----------------------------------------------------------- //

export function showView(state: AppState, view: ViewName): AppState {
  return { ...state, view };
}

export function selectFacility(state: AppState, id: string | null): AppState {
  return { ...state, selectedId: id };
}

export function withFilters(state: AppState, filters: Filters): AppState {
  return { ...state, filters };
}

/** Pick a night in the calendar, or clear it by picking the same one again. */
export function pickNight(state: AppState, night: Night | null): AppState {
  return { ...state, filters: { ...state.filters, night } };
}

export function travelStarted(state: AppState, query: string): AppState {
  return {
    ...state,
    travel: {
      ...state.travel,
      query,
      status: "working",
      error: null,
      progress: "Looking up address…",
    },
  };
}

export function travelProgressed(state: AppState, progress: string): AppState {
  return { ...state, travel: { ...state.travel, progress } };
}

export function travelLocated(state: AppState, origin: Origin): AppState {
  return {
    ...state,
    travel: { ...state.travel, origin, progress: "Calculating driving times…" },
  };
}

export function travelReady(state: AppState, times: TravelTimes): AppState {
  return { ...state, travel: { ...state.travel, times, status: "ready", progress: null } };
}

export function travelFailed(state: AppState, error: string): AppState {
  return { ...state, travel: { ...state.travel, status: "error", error, progress: null } };
}

/**
 * Forget the address.
 *
 * The drive-time limit and nearest-first sort go with it: both are relative to
 * an origin, and left behind they would silently hide everything.
 */
export function clearTravel(state: AppState): AppState {
  return {
    ...state,
    travel: initialTravel(""),
    filters: { ...state.filters, maxDriveMinutes: null, sortBy: "confidence" },
  };
}

export function updateOffered(state: AppState): AppState {
  return { ...state, updateAvailable: true };
}

/**
 * Take up a refreshed dataset.
 *
 * Not a plain assignment. Filters carry over untouched, but anything keyed by
 * facility id has to be reconciled against what still exists: a selection
 * pointing at a departed facility becomes no selection, and travel times keep
 * only the ids that survived — otherwise a drive time would sit on a facility
 * that is no longer there.
 */
export function adoptDataset(state: AppState, next: Dataset): AppState {
  const ids = facilityIds(next);
  return {
    ...state,
    selectedId:
      state.selectedId && ids.has(state.selectedId) ? state.selectedId : null,
    travel: { ...state.travel, times: state.travel.times.retaining(ids) },
    updateAvailable: false,
  };
}

// --- view model ------------------------------------------------------------ //

export interface NightDetail {
  night: Night;
  bookable: Match[];
  others: Match[];
}

export interface ViewModel {
  view: ViewName;
  /** What the list and map show. */
  matches: Match[];
  /** What the calendar's detail shows: Nights and Dates deliberately not applied. */
  calendarMatches: Match[];
  tally: Map<Night, NightTally>;
  /** The picked night, split into what must be booked and what need not be. */
  nightDetail: NightDetail | null;
  selected: Match | null;
  travel: TravelState;
  status: string;
  updateAvailable: boolean;
  totalFacilities: number;
}

export function deriveViewModel(dataset: Dataset, state: AppState): ViewModel {
  const { filters, travel } = state;
  const matches = findMatches(dataset, filters, travel.times);
  const calendarMatches = findCalendarMatches(dataset, filters, travel.times);
  const tally = tallyNights(dataset, filters, travel.times);

  const nightDetail: NightDetail | null = filters.night
    ? { night: filters.night, ...splitByBookability(calendarMatches) }
    : null;

  const selected =
    matches.find((match) => match.facility.id === state.selectedId) ?? null;

  const status =
    `${matches.length} of ${dataset.facilities.length} places match` +
    (filters.night ? ` on ${filters.night}` : "") +
    ` · availability checked ${dataset.checkedAt.slice(0, 10)}`;

  return {
    view: state.view,
    matches,
    calendarMatches,
    tally,
    nightDetail,
    selected,
    travel,
    status,
    updateAvailable: state.updateAvailable,
    totalFacilities: dataset.facilities.length,
  };
}

/** Destinations for the router, in dataset order. */
export function destinationsOf(dataset: Dataset): { id: string; position: Facility["position"] }[] {
  return dataset.facilities.map((f) => ({ id: f.id, position: f.position }));
}
