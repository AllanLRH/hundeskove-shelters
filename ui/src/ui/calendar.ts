/**
 * The horizon as a Monday-first grid, one cell per night.
 *
 * Deliberately shows the whole horizon regardless of the Nights and Dates
 * filters: its job is to reveal the pattern across the period, and narrowing it
 * the same way the list is narrowed would make clicking a cell open an empty
 * detail panel.
 */

import { DAY_LABELS, intoWeeks, isoWeek, nightIndex, NIGHT_LABELS, type Night } from "../domain/night";
import type { Dataset } from "../domain/dataset";
import type { NightDetail } from "../app/state";
import type { NightTally } from "../domain/search";
import type { TravelTimes } from "../domain/travel";
import { facilityCard } from "./card";

const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const NIGHT_HEADING = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export interface CalendarHandlers {
  onPickNight: (night: Night | null) => void;
  onSelect: (id: string) => void;
}

export function renderCalendar(
  root: HTMLElement,
  dataset: Dataset,
  tally: Map<Night, NightTally>,
  detail: NightDetail | null,
  selectedId: string | null,
  travel: TravelTimes,
  handlers: CalendarHandlers,
): void {
  root.replaceChildren();

  const legend = document.createElement("p");
  legend.className = "cal-legend";
  legend.textContent =
    "The week runs Monday to Sunday. Each cell is the night you arrive on that day — " +
    "Fri is the fri–sat night. Top number: bookable places free. Bottom: free/first-come matching. " +
    "Click a night to see which places they are. Shows the whole horizon regardless of the " +
    "Nights and Dates filters, which apply to the list and map only.";
  root.append(legend);

  if (detail) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "clear-day";
    clear.textContent = `Showing only ${detail.night} — clear`;
    clear.addEventListener("click", () => handlers.onPickNight(null));
    root.append(clear);
  }

  const byMonth = new Map<string, Night[]>();
  for (const night of dataset.nights) {
    const key = night.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(night);
  }

  for (const [month, nights] of byMonth) {
    const section = document.createElement("section");
    section.className = "cal-month";
    const heading = document.createElement("h3");
    heading.textContent = MONTH_FORMAT.format(new Date(`${month}-01T12:00:00Z`));
    section.append(heading, grid(nights, tally, detail?.night ?? null, handlers));
    root.append(section);

    // Put the detail under the month it belongs to, so it appears next to the
    // cell that was clicked rather than somewhere off-screen.
    if (detail && detail.night.slice(0, 7) === month) {
      root.append(renderNightDetail(detail, selectedId, travel, handlers.onSelect));
    }
  }
}

function grid(
  nights: readonly Night[],
  tally: Map<Night, NightTally>,
  picked: Night | null,
  handlers: CalendarHandlers,
): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "cal-grid";

  // A blank above the week-number column.
  grid.append(document.createElement("div"));
  DAY_LABELS.forEach((label, index) => {
    const head = document.createElement("div");
    head.className = "cal-head";
    if (index >= 5) head.classList.add("weekend-day");
    const day = document.createElement("span");
    day.className = "cal-head-day";
    day.textContent = label;
    const night = document.createElement("span");
    night.className = "cal-head-night";
    night.textContent = `→${DAY_LABELS[(index + 1) % 7]}`;
    head.append(day, night);
    grid.append(head);
  });

  for (const week of intoWeeks(nights)) {
    const first = week.find((night): night is Night => night !== null)!;
    const label = document.createElement("div");
    label.className = "cal-week";
    label.textContent = `W${isoWeek(first)}`;
    label.title = `ISO week ${isoWeek(first)}`;
    grid.append(label);

    for (const night of week) {
      if (night === null) {
        grid.append(document.createElement("div"));
        continue;
      }
      grid.append(cell(night, tally.get(night)!, picked, handlers));
    }
  }
  return grid;
}

function cell(
  night: Night,
  counts: NightTally,
  picked: Night | null,
  handlers: CalendarHandlers,
): HTMLElement {
  const index = nightIndex(night);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cal-cell";
  if (picked === night) button.classList.add("picked");
  if (counts.bookable === 0 && counts.open === 0) button.classList.add("none");

  const day = document.createElement("span");
  day.className = "cal-day";
  day.textContent = String(Number(night.slice(8, 10)));
  const bookable = document.createElement("span");
  bookable.className = "cal-bookable";
  bookable.textContent = String(counts.bookable);
  const open = document.createElement("span");
  open.className = "cal-open";
  open.textContent = String(counts.open);
  button.append(day, bookable, open);
  button.title = `${night} (${NIGHT_LABELS[index]}): ${counts.bookable} bookable, ${counts.open} first-come`;
  button.addEventListener("click", () =>
    handlers.onPickNight(picked === night ? null : night),
  );
  return button;
}

/**
 * Which places are free on one night.
 *
 * Bookable places are listed in full — they are the ones that need a link and
 * can run out. First-come places are free every night by definition, so listing
 * all of them would bury the answer; they go behind a disclosure.
 */
function renderNightDetail(
  detail: NightDetail,
  selectedId: string | null,
  travel: TravelTimes,
  onSelect: (id: string) => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "day-detail";

  const heading = document.createElement("h3");
  heading.textContent =
    `${NIGHT_HEADING.format(new Date(`${detail.night}T12:00:00Z`))} — ` +
    `the ${NIGHT_LABELS[nightIndex(detail.night)]} night`;
  section.append(heading);

  const card = (match: { facility: Parameters<typeof facilityCard>[0]; nights: readonly Night[] }) =>
    facilityCard(match.facility, match.nights, {
      selected: match.facility.id === selectedId,
      onSelect,
      highlightNight: detail.night,
      driveSeconds: travel.get(match.facility.id) ?? null,
    });

  if (detail.bookable.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing bookable is free this night under the current filters.";
    section.append(empty);
  } else {
    const lead = document.createElement("p");
    lead.className = "detail-lead";
    lead.textContent = `${detail.bookable.length} bookable place${
      detail.bookable.length === 1 ? "" : "s"
    } free:`;
    section.append(lead, ...detail.bookable.map(card));
  }

  if (detail.others.length > 0) {
    const disclosure = document.createElement("details");
    disclosure.className = "other-places";
    const summary = document.createElement("summary");
    summary.textContent = `${detail.others.length} more that need no booking (or are booked elsewhere)`;
    disclosure.append(summary, ...detail.others.map(card));
    section.append(disclosure);
  }
  return section;
}
