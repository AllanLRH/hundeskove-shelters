import type { Filters } from "./filters";
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
  onChange: () => void,
): void {
  root.replaceChildren();

  const nights = group(
    "Nights",
    "A night is named by the day you arrive. Weekends are on by default.",
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

  const dates = group("Dates");
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

  root.append(nights, dates, availability, confidence, proximity, types);
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
