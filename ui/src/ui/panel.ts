/** The filter sidebar. Reads filters, writes filters, knows nothing else. */

import type { Dataset } from "../domain/dataset";
import { facilityTypes } from "../domain/dataset";
import {
  AVAILABILITY_LABEL,
  CONFIDENCE_LABEL,
  CONFIDENCE_ORDER,
  type AvailabilityKind,
  type Confidence,
} from "../domain/facility";
import { MAX_DISTANCE_M, type Filters } from "../domain/filters";
import { NIGHT_LABELS, WEEKEND_NIGHTS, type NightIndex } from "../domain/night";
import { formatDuration } from "../domain/travel";
import type { TravelState } from "../app/state";

/** Slider ceiling; at the top it means "no limit" rather than four hours. */
const MAX_DRIVE_MINUTES = 240;

export interface PanelHandlers {
  onChange: () => void;
  onAddress: (query: string) => void;
  onClearAddress: () => void;
}

export function renderPanel(
  root: HTMLElement,
  dataset: Dataset,
  filters: Filters,
  travel: TravelState,
  handlers: PanelHandlers,
): void {
  const { onChange } = handlers;
  root.replaceChildren(
    travelGroup(filters, travel, handlers),
    nightsGroup(filters, onChange),
    datesGroup(dataset, filters, onChange),
    availabilityGroup(filters, onChange),
    confidenceGroup(filters, onChange),
    proximityGroup(filters, onChange),
    typesGroup(dataset, filters, onChange),
  );
}

// --- groups ---------------------------------------------------------------- //

function nightsGroup(filters: Filters, onChange: () => void): HTMLElement {
  const section = group(
    "Nights",
    "A night is named by the day you arrive. Weekends are on by default. " +
      "Applies to the list and map — the calendar always shows every night.",
  );
  const grid = document.createElement("div");
  grid.className = "night-grid";
  NIGHT_LABELS.forEach((label, index) => {
    grid.append(
      toggle(label, index as NightIndex, filters.nights, onChange,
        WEEKEND_NIGHTS.includes(index as NightIndex) ? "weekend" : ""),
    );
  });
  const buttons = document.createElement("div");
  buttons.className = "row-buttons";
  buttons.append(
    quick("Weekends", () => {
      filters.nights = new Set(WEEKEND_NIGHTS);
      onChange();
    }),
    quick("All nights", () => {
      filters.nights = new Set<NightIndex>([0, 1, 2, 3, 4, 5, 6]);
      onChange();
    }),
  );
  section.append(grid, buttons);
  return section;
}

function datesGroup(dataset: Dataset, filters: Filters, onChange: () => void): HTMLElement {
  const section = group("Dates", "Applies to the list and map, not the calendar.");
  section.append(
    dateInput("From", filters.from, dataset, (value) => {
      filters.from = value;
      onChange();
    }),
    dateInput("To", filters.to, dataset, (value) => {
      filters.to = value;
      onChange();
    }),
  );
  return section;
}

function availabilityGroup(filters: Filters, onChange: () => void): HTMLElement {
  const section = group(
    "Availability",
    "Most places need no booking at all — those are free every night.",
  );
  for (const kind of ["bookable", "open", "unknown"] as AvailabilityKind[]) {
    section.append(toggle(AVAILABILITY_LABEL[kind], kind, filters.availability, onChange));
  }
  return section;
}

function confidenceGroup(filters: Filters, onChange: () => void): HTMLElement {
  const section = group(
    "Certainty it is in a dog forest",
    "Marker-only forests have no mapped outline, so their distance is measured to a pin.",
  );
  for (const tier of CONFIDENCE_ORDER) {
    section.append(
      toggle(CONFIDENCE_LABEL[tier], tier as Confidence, filters.confidence, onChange, `conf-${tier}`),
    );
  }
  return section;
}

function proximityGroup(filters: Filters, onChange: () => void): HTMLElement {
  const section = group("Proximity");
  section.append(
    slider(`Max distance: ${filters.maxDistanceM} m`, filters.maxDistanceM, 0, MAX_DISTANCE_M, 10, (value) => {
      filters.maxDistanceM = value;
      onChange();
    }),
    slider(
      `Min overlap (areas): ${Math.round(filters.minOverlap * 100)}%`,
      filters.minOverlap * 100, 0, 100, 5,
      (value) => {
        filters.minOverlap = value / 100;
        onChange();
      },
    ),
  );
  return section;
}

function typesGroup(dataset: Dataset, filters: Filters, onChange: () => void): HTMLElement {
  const section = group("Facility type");
  for (const type of facilityTypes(dataset)) {
    section.append(toggle(type, type, filters.facilityTypes, onChange));
  }
  return section;
}

/**
 * Address entry and the drive-time controls it unlocks.
 *
 * A real <form> so Enter submits. The input keeps its value through re-renders
 * via `defaultValue`; a controlled `value` would fight the user's typing, since
 * the panel is rebuilt on every filter change.
 */
function travelGroup(
  filters: Filters,
  travel: TravelState,
  handlers: PanelHandlers,
): HTMLElement {
  const section = group(
    "Drive time",
    "Your address stays on this device and is never put in the shareable link.",
  );

  const form = document.createElement("form");
  form.className = "address-form";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "address-input";
  input.placeholder = "Your address…";
  input.autocomplete = "street-address";
  input.defaultValue = travel.query;
  input.setAttribute("aria-label", "Your address, for driving times");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "quick";
  submit.textContent = travel.status === "working" ? "…" : "Go";
  submit.disabled = travel.status === "working";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.onAddress(input.value);
  });
  form.append(input, submit);
  section.append(form);

  if (travel.status === "working") {
    section.append(hint(travel.progress ?? "Looking up…", "travel-status"));
  }
  if (travel.status === "error" && travel.error) {
    section.append(hint(travel.error, "travel-error"));
  }

  if (travel.status === "ready" && travel.origin) {
    const found = hint(`From ${travel.origin.label}`, "travel-origin");
    found.title = travel.origin.label;
    section.append(found);

    section.append(
      slider(
        filters.maxDriveMinutes === null
          ? "Max drive: no limit"
          : `Max drive: ${formatDuration(filters.maxDriveMinutes * 60)}`,
        // The top of the range doubles as "no limit", so the slider has
        // somewhere to go that stops filtering without a second control.
        filters.maxDriveMinutes ?? MAX_DRIVE_MINUTES,
        15, MAX_DRIVE_MINUTES, 15,
        (value) => {
          filters.maxDriveMinutes = value >= MAX_DRIVE_MINUTES ? null : value;
          handlers.onChange();
        },
      ),
    );

    const sort = document.createElement("label");
    sort.className = "toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = filters.sortBy === "drive";
    box.addEventListener("change", () => {
      filters.sortBy = box.checked ? "drive" : "confidence";
      handlers.onChange();
    });
    const text = document.createElement("span");
    text.textContent = "Sort nearest first";
    sort.append(box, text);

    const buttons = document.createElement("div");
    buttons.className = "row-buttons";
    buttons.append(quick("Clear address", handlers.onClearAddress));
    section.append(sort, buttons);
  }

  return section;
}

// --- building blocks ------------------------------------------------------- //

function group(title: string, note?: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "filter-group";
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading);
  if (note) section.append(hint(note));
  return section;
}

function hint(text: string, extraClass = ""): HTMLElement {
  const note = document.createElement("p");
  note.className = `hint ${extraClass}`.trim();
  note.textContent = text;
  return note;
}

function toggle<T>(
  label: string,
  value: T,
  set: Set<T>,
  onChange: () => void,
  className = "",
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = `toggle ${className}`.trim();
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = set.has(value);
  input.addEventListener("change", () => {
    if (input.checked) set.add(value);
    else set.delete(value);
    onChange();
  });
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(input, text);
  return wrapper;
}

function quick(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quick";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function dateInput(
  label: string,
  value: string,
  dataset: Dataset,
  onInput: (value: string) => void,
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "date";
  input.value = value;
  input.min = dataset.horizon.start;
  input.max = dataset.horizon.end;
  input.addEventListener("change", () => onInput(input.value));
  wrapper.append(text, input);
  return wrapper;
}

function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => onInput(Number(input.value)));
  wrapper.append(text, input);
  return wrapper;
}
