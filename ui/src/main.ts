/**
 * Wiring only: build the collaborators, hold the state, paint on change.
 *
 * Every decision lives in `domain/` or `app/`; this file's job is to connect
 * them to the browser. That is also why the interesting behaviour can be tested
 * without one.
 */

import "leaflet/dist/leaflet.css";
import "./styles.css";

import { fromHash, toHash } from "./domain/shareLink";
import type { Filters } from "./domain/filters";
import type { Night } from "./domain/night";
import { loadDataset } from "./io/load";
import { readDriveCache, writeDriveCache } from "./io/driveCache";
import { NominatimGeocoder } from "./io/geocoding";
import { OsrmRouter } from "./io/routing";
import { ADDRESS_KEY, localStore } from "./io/storage";
import { StaticDatasetSource, type DatasetSource } from "./io/datasetSource";
import {
  adoptDataset,
  clearTravel,
  deriveViewModel,
  initialState,
  pickNight,
  selectFacility,
  showView,
  updateOffered,
  withFilters,
  type AppState,
  type ViewName,
} from "./app/state";
import { lookUpTravel } from "./app/lookUpTravel";
import { renderCalendar } from "./ui/calendar";
import { facilityCard } from "./ui/card";
import { renderList } from "./ui/list";
import { MapView } from "./ui/map";
import { renderPanel } from "./ui/panel";
import { initTheme } from "./ui/theme";

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const VIEWS: ViewName[] = ["list", "calendar", "map"];

async function start(): Promise<void> {
  initTheme(el<HTMLButtonElement>("theme-toggle"));

  const status = el("status");
  let source: DatasetSource;
  try {
    source = new StaticDatasetSource(await loadDataset());
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add("error");
    return;
  }

  let dataset = source.current().dataset;
  let state: AppState = initialState(
    dataset,
    fromHash(location.hash, dataset),
    localStore.get(ADDRESS_KEY) ?? "",
  );

  // Nothing offers a newer dataset yet, but the seam is live: when a polling
  // source replaces the static one, the banner and the adopt path already work.
  source.subscribe(() => {
    state = updateOffered(state);
    render();
  });

  const geocoder = new NominatimGeocoder();
  const router = new OsrmRouter();
  const mapView = new MapView(el("map-canvas"), (id) => set(selectFacility(state, id)));
  mapView.drawForests(dataset);

  function set(next: AppState): void {
    state = next;
    render();
  }

  function syncHash(): void {
    history.replaceState(null, "", `#${toHash(state.filters, dataset)}`);
  }

  function changeFilters(filters: Filters): void {
    state = withFilters(state, filters);
    syncHash();
    render();
  }

  function choose(id: string): void {
    set(selectFacility(state, id));
    if (state.view === "map") mapView.focus(id);
  }

  function choosePickNight(night: Night | null): void {
    state = pickNight(state, night);
    syncHash();
    render();
  }

  async function onAddress(query: string): Promise<void> {
    state = await lookUpTravel(state, dataset, query, {
      geocoder,
      router,
      readCache: (origin) => readDriveCache(origin as never),
      writeCache: (origin, times) => writeDriveCache(origin as never, times),
      rememberAddress: (value) =>
        value ? localStore.set(ADDRESS_KEY, value) : localStore.remove(ADDRESS_KEY),
    }, set);
  }

  function onClearAddress(): void {
    localStore.remove(ADDRESS_KEY);
    state = clearTravel(state);
    syncHash();
    render();
  }

  function adopt(): void {
    dataset = source.adopt().dataset;
    state = adoptDataset(state, dataset);
    mapView.drawForests(dataset);
    render();
  }
  // Referenced so the seam is obviously wired rather than dead; the banner that
  // calls it arrives with the polling source.
  void adopt;

  function render(): void {
    const vm = deriveViewModel(dataset, state);
    status.textContent = vm.status;

    renderPanel(el("panel"), dataset, state.filters, vm.travel, {
      onChange: () => changeFilters(state.filters),
      onAddress: (query) => void onAddress(query),
      onClearAddress,
    });

    renderList(
      el("view-list"), vm.matches, state.selectedId, choose,
      state.filters.night, vm.travel.times,
    );
    renderCalendar(
      el("view-calendar"), dataset, vm.tally, vm.nightDetail,
      state.selectedId, vm.travel.times,
      { onPickNight: choosePickNight, onSelect: choose },
    );
    mapView.render(vm.matches, state.selectedId);
    renderMapDetail(vm.selected, vm.travel.times, state.filters.night);

    for (const name of VIEWS) {
      el(`view-${name}`).hidden = name !== state.view;
      el(`tab-${name}`).classList.toggle("active", name === state.view);
    }
    // Leaflet cannot measure a hidden container, so re-measure once shown.
    if (state.view === "map") mapView.refresh();
  }

  function renderMapDetail(
    selected: ReturnType<typeof deriveViewModel>["selected"],
    times: ReturnType<typeof deriveViewModel>["travel"]["times"],
    highlightNight: Night | null,
  ): void {
    const root = el("map-detail");
    root.replaceChildren();
    if (!selected) {
      const hint = document.createElement("p");
      hint.className = "map-hint";
      hint.textContent =
        "Click a marker to see which nights it is free and where to book it.";
      root.append(hint);
      return;
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "clear-day";
    clear.textContent = "Clear selection";
    clear.addEventListener("click", () => set(selectFacility(state, null)));
    root.append(clear);
    root.append(
      facilityCard(selected.facility, selected.nights, {
        selected: true,
        // Every night, not the list's preview: this is the detail view.
        maxNights: Infinity,
        highlightNight,
        driveSeconds: times.get(selected.facility.id) ?? null,
      }),
    );
  }

  for (const name of VIEWS) {
    el(`tab-${name}`).addEventListener("click", () => set(showView(state, name)));
  }
  el("map-home").addEventListener("click", () => mapView.home());
  el("map-fit").addEventListener("click", () => mapView.fitToResults());
  window.addEventListener("hashchange", () => changeFilters(fromHash(location.hash, dataset)));

  render();
}

void start();
