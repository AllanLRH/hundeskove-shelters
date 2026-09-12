import "leaflet/dist/leaflet.css";
import "./styles.css";

import { loadDataset } from "./data";
import { applyFilters, fromHash, toHash, type Filters, type Hit } from "./filters";
import { renderPanel } from "./panel";
import { initTheme } from "./theme";
import { facilityCard } from "./views/card";
import { renderCalendar } from "./views/calendar";
import { renderList } from "./views/list";
import { MapView } from "./views/map";
import type { Dataset } from "./types";

type ViewName = "list" | "calendar" | "map";

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

async function start(): Promise<void> {
  initTheme(el<HTMLButtonElement>("theme-toggle"));

  const status = el("status");
  let data: Dataset;
  try {
    data = await loadDataset();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add("error");
    return;
  }

  let filters: Filters = fromHash(location.hash, data);
  let view: ViewName = "list";
  let selected: string | null = null;

  const mapView = new MapView(el("map-canvas"), (id) => {
    selected = id;
    render();
  });
  mapView.drawForests(data);

  function select(id: string): void {
    selected = id;
    render();
    if (view === "map") mapView.focus(id);
  }

  /** The detail for whichever marker is selected, shown beneath the map. */
  function renderMapDetail(hits: Hit[]): void {
    const root = el("map-detail");
    root.replaceChildren();

    const hit = hits.find((candidate) => candidate.facility.shelter_id === selected);
    if (!hit) {
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
    clear.addEventListener("click", () => {
      selected = null;
      render();
    });
    root.append(clear);
    // Every night, not the list's truncated preview: this is the detail view.
    root.append(
      facilityCard(hit.facility, hit.nights, {
        selected: true,
        maxDates: Infinity,
        highlightDate: filters.day,
      }),
    );
  }

  function render(): void {
    const hits = applyFilters(data, filters);

    status.textContent =
      `${hits.length} of ${data.facilities.length} places match` +
      (filters.day ? ` on ${filters.day}` : "") +
      ` · availability checked ${data.checkedAt.slice(0, 10)}`;

    renderPanel(el("panel"), data, filters, () => {
      history.replaceState(null, "", `#${toHash(filters, data)}`);
      render();
    });

    renderList(el("view-list"), hits, selected, select, filters.day);
    renderCalendar(
      el("view-calendar"),
      data,
      filters,
      hits,
      (day) => {
        filters.day = day;
        history.replaceState(null, "", `#${toHash(filters, data)}`);
        render();
      },
      select,
      selected,
    );
    mapView.render(hits, selected);
    renderMapDetail(hits);

    for (const name of ["list", "calendar", "map"] as ViewName[]) {
      el(`view-${name}`).hidden = name !== view;
      el(`tab-${name}`).classList.toggle("active", name === view);
    }
    // The map cannot measure a hidden container, so re-measure once shown.
    if (view === "map") mapView.refresh();
  }

  for (const name of ["list", "calendar", "map"] as ViewName[]) {
    el(`tab-${name}`).addEventListener("click", () => {
      view = name;
      render();
    });
  }

  el("map-home").addEventListener("click", () => mapView.home());
  el("map-fit").addEventListener("click", () => mapView.fitToResults());

  window.addEventListener("hashchange", () => {
    filters = fromHash(location.hash, data);
    render();
  });

  render();
}

void start();
