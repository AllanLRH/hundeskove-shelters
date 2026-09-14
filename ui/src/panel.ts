import type { Filters } from "./filters";
import { formatDuration, type TravelState } from "./travel";
import {
  AVAILABILITY_LABEL,
  CONFIDENCE_LABEL,
  CONFIDENCE_ORDER,
  NIGHT_LABELS,
  type Availability,
  type Confidence,
  type Dataset,
  type NightIndex,
} from "./types";

function group(title: string, hint?: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "filter-group";
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading);
  if (hint) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = hint;
    section.append(note);
  }
  return section;
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

export function renderPanel(
  root: HTMLElement,
  data: Dataset,
  filters: Filters,
  travel: TravelState,
  onChange: () => void,
  onAddress: (query: string) => void,
  onClearAddress: () => void,
): void {
  root.replaceChildren();

  const nights = group(
    "Nights",
    "A night is named by the day you arrive. Weekends are on by default. " +
      "Applies to the list and map — the calendar always shows every night.",
  );
  const nightGrid = document.createElement("div");
  nightGrid.className = "night-grid";
  NIGHT_LABELS.forEach((label, index) => {
    nightGrid.append(
      toggle(
        label,
        index as NightIndex,
        filters.nights,
        onChange,
        index >= 4 && index <= 5 ? "weekend" : "",
      ),
    );
  });
  const nightButtons = document.createElement("div");
  nightButtons.className = "row-buttons";
  nightButtons.append(
    quick("Weekends", () => {
      filters.nights = new Set<NightIndex>([4, 5]);
      onChange();
    }),
    quick("All nights", () => {
      filters.nights = new Set<NightIndex>([0, 1, 2, 3, 4, 5, 6]);
      onChange();
    }),
  );
  nights.append(nightGrid, nightButtons);

  const dates = group("Dates", "Applies to the list and map, not the calendar.");
  dates.append(
    dateInput("From", filters.from, data, (value) => {
      filters.from = value;
      onChange();
    }),
    dateInput("To", filters.to, data, (value) => {
      filters.to = value;
      onChange();
    }),
  );

  const availability = group(
    "Availability",
    "Most places need no booking at all — those are free every night.",
  );
  (["calendar", "open", "unknown"] as Availability[]).forEach((value) => {
    availability.append(
      toggle(AVAILABILITY_LABEL[value], value, filters.availability, onChange),
    );
  });

  const confidence = group(
    "Certainty it is in a dog forest",
    "Marker-only forests have no mapped outline, so their distance is measured to a pin.",
  );
  CONFIDENCE_ORDER.forEach((value: Confidence) => {
    confidence.append(
      toggle(CONFIDENCE_LABEL[value], value, filters.confidence, onChange, `conf-${value}`),
    );
  });

  const proximity = group("Proximity");
  proximity.append(
    slider(
      `Max distance: ${filters.maxDistance} m`,
      filters.maxDistance,
      0,
      500,
      10,
      (value) => {
        filters.maxDistance = value;
        onChange();
      },
    ),
    slider(
      `Min overlap (areas): ${Math.round(filters.minOverlap * 100)}%`,
      filters.minOverlap * 100,
      0,
      100,
      5,
      (value) => {
        filters.minOverlap = value / 100;
        onChange();
      },
    ),
  );

  const types = group("Facility type");
  [...new Set(data.facilities.map((f) => f.facility_type))]
    .sort()
    .forEach((value) => {
      types.append(toggle(value, value, filters.facilityTypes, onChange));
    });

  root.append(
    travelGroup(filters, travel, onChange, onAddress, onClearAddress),
    nights,
    dates,
    availability,
    confidence,
    proximity,
    types,
  );
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
  data: Dataset,
  onInput: (value: string) => void,
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "date";
  input.value = value;
  input.min = data.horizonStart;
  input.max = data.horizonEnd;
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

/**
 * Address entry plus the drive-time controls it unlocks.
 *
 * The form is a real <form> so Enter submits, and the address input keeps its
 * own value across re-renders via `defaultValue` — the panel is rebuilt on
 * every filter change, and a controlled `value` would fight the user's typing.
 */
function travelGroup(
  filters: Filters,
  travel: TravelState,
  onChange: () => void,
  onAddress: (query: string) => void,
  onClearAddress: () => void,
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
    onAddress(input.value);
  });
  form.append(input, submit);
  section.append(form);

  if (travel.status === "working") {
    const note = document.createElement("p");
    note.className = "hint travel-status";
    note.textContent = travel.progress ?? "Looking up…";
    section.append(note);
  }

  if (travel.status === "error" && travel.error) {
    const note = document.createElement("p");
    note.className = "hint travel-error";
    note.textContent = travel.error;
    section.append(note);
  }

  if (travel.status === "ready" && travel.origin) {
    const found = document.createElement("p");
    found.className = "hint travel-origin";
    found.textContent = `From ${travel.origin.label}`;
    found.title = travel.origin.label;
    section.append(found);

    section.append(
      slider(
        filters.maxDriveMinutes === null
          ? "Max drive: no limit"
          : `Max drive: ${formatDuration(filters.maxDriveMinutes * 60)}`,
        // The top of the range doubles as "no limit", so the slider has
        // somewhere to go that means "stop filtering" without a second control.
        filters.maxDriveMinutes ?? MAX_DRIVE_MINUTES,
        15,
        MAX_DRIVE_MINUTES,
        15,
        (value) => {
          filters.maxDriveMinutes = value >= MAX_DRIVE_MINUTES ? null : value;
          onChange();
        },
      ),
    );

    const sort = document.createElement("label");
    sort.className = "toggle";
    const sortBox = document.createElement("input");
    sortBox.type = "checkbox";
    sortBox.checked = filters.sortBy === "drive";
    sortBox.addEventListener("change", () => {
      filters.sortBy = sortBox.checked ? "drive" : "confidence";
      onChange();
    });
    const sortText = document.createElement("span");
    sortText.textContent = "Sort nearest first";
    sort.append(sortBox, sortText);
    section.append(sort);

    const buttons = document.createElement("div");
    buttons.className = "row-buttons";
    buttons.append(
      quick("Clear address", () => {
        onClearAddress();
      }),
    );
    section.append(buttons);
  }

  return section;
}

/** Slider ceiling; at the top it means "no limit" rather than four hours. */
const MAX_DRIVE_MINUTES = 240;
