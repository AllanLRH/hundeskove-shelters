import "leaflet/dist/leaflet.css";
import "./styles.css";

import { loadDataset } from "./data";
import { applyFilters, fromHash, toHash, type Filters } from "./filters";
import { renderPanel } from "./panel";
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

  const mapView = new MapView(el("view-map"), (id) => {
    selected = id;
    render();
  });
  mapView.drawForests(data);

  function select(id: string): void {
    selected = id;
    render();
    if (view === "map") mapView.focus(id);
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

    renderList(el("view-list"), hits, selected, select);
    renderCalendar(el("view-calendar"), data, filters, (day) => {
      filters.day = day;
      history.replaceState(null, "", `#${toHash(filters, data)}`);
      render();
    });
    mapView.render(hits, selected);

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

  window.addEventListener("hashchange", () => {
    filters = fromHash(location.hash, data);
    render();
  });

  render();
}

void start();
