import { isoWeek, nightIndex } from "../data";
import { passesAttributes, type Filters, type Hit } from "../filters";
import { DAY_LABELS, NIGHT_LABELS, type Dataset } from "../types";
import { facilityCard } from "./card";

interface DayCount {
  bookable: number;
  open: number;
}

/**
 * Count, per night, how many facilities are free.
 *
 * Bookable and first-come are counted separately on purpose: the 244 first-come
 * sites are free every night, so a single total would be dominated by a constant
 * and the interesting signal — which nights are actually still bookable — would
 * be invisible.
 */
function countNights(data: Dataset, filters: Filters): Map<string, DayCount> {
  const counts = new Map<string, DayCount>();
  for (const date of data.allDates) counts.set(date, { bookable: 0, open: 0 });

  for (const facility of data.facilities) {
    if (!passesAttributes(facility, filters)) continue;
    for (const date of facility.nights) {
      const entry = counts.get(date);
      if (!entry) continue;
      if (facility.availability === "calendar") entry.bookable += 1;
      else entry.open += 1;
    }
  }
  return counts;
}

const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function renderCalendar(
  root: HTMLElement,
  data: Dataset,
  filters: Filters,
  hits: Hit[],
  onPickDay: (date: string | null) => void,
  onSelect: (id: string) => void,
  selectedId: string | null,
): void {
  root.replaceChildren();
  const counts = countNights(data, filters);

  const legend = document.createElement("p");
  legend.className = "cal-legend";
  legend.textContent =
    "The week runs Monday to Sunday. Each cell is the night you arrive on that day — " +
    "Fri is the fri–sat night. Top number: bookable places free. Bottom: free/first-come matching. " +
    "Click a night to see which places they are. Shows the whole horizon regardless of the " +
    "Nights and Dates filters, which apply to the list and map only.";
  root.append(legend);

  if (filters.day) {
    const clear = document.createElement("button");
    clear.className = "clear-day";
    clear.textContent = `Showing only ${filters.day} — clear`;
    clear.addEventListener("click", () => onPickDay(null));
    root.append(clear);
  }

  const byMonth = new Map<string, string[]>();
  for (const date of data.allDates) {
    const key = date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(date);
  }

  for (const [month, dates] of byMonth) {
    const section = document.createElement("section");
    section.className = "cal-month";
    const heading = document.createElement("h3");
    heading.textContent = MONTH_FORMAT.format(new Date(`${month}-01T12:00:00Z`));
    section.append(heading);

    const grid = document.createElement("div");
    grid.className = "cal-grid";

    // A leading column for the week number, so the header row needs a blank
    // spacer above it.
    grid.append(document.createElement("div"));
    // Monday-first, ending Sunday: the Danish/ISO week. The day name is the
    // arrival day, with the night it opens shown underneath.
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

    // Group into whole weeks (Monday-first) so a week-number cell can lead
    // each row. The first and last rows are padded with blanks rather than
    // days from adjacent months, matching the existing month-by-month layout.
    const weeks: (string | null)[][] = [];
    let row: (string | null)[] = new Array(nightIndex(dates[0]!)).fill(null);
    for (const date of dates) {
      row.push(date);
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
    if (row.length > 0) {
      weeks.push([...row, ...new Array(7 - row.length).fill(null)]);
    }

    for (const week of weeks) {
      const firstDate = week.find((date): date is string => date !== null)!;
      const weekLabel = document.createElement("div");
      weekLabel.className = "cal-week";
      weekLabel.textContent = `W${isoWeek(firstDate)}`;
      weekLabel.title = `ISO week ${isoWeek(firstDate)}`;
      grid.append(weekLabel);

      for (const date of week) {
        if (date === null) {
          grid.append(document.createElement("div"));
          continue;
        }
        const night = nightIndex(date);
        const entry = counts.get(date)!;
        const cell = document.createElement("button");
        cell.className = "cal-cell";
        // The Nights and Dates filters deliberately do not reach the calendar
        // — it always shows the whole horizon, so a night dimmed there for
        // being outside those filters would have made a clickable cell whose
        // own day-detail then had nothing to show.
        if (filters.day === date) cell.classList.add("picked");
        if (entry.bookable === 0 && entry.open === 0) cell.classList.add("none");

        const day = document.createElement("span");
        day.className = "cal-day";
        day.textContent = String(Number(date.slice(8, 10)));
        const bookable = document.createElement("span");
        bookable.className = "cal-bookable";
        bookable.textContent = String(entry.bookable);
        const open = document.createElement("span");
        open.className = "cal-open";
        open.textContent = String(entry.open);
        cell.append(day, bookable, open);
        cell.title = `${date} (${NIGHT_LABELS[night]}): ${entry.bookable} bookable, ${entry.open} first-come`;
        cell.addEventListener("click", () =>
          onPickDay(filters.day === date ? null : date),
        );
        grid.append(cell);
      }
    }
    section.append(grid);
    root.append(section);

    // Put the detail right under the month it belongs to, so it appears next to
    // the cell that was clicked rather than somewhere off-screen.
    if (filters.day && filters.day.slice(0, 7) === month) {
      root.append(renderDayDetail(filters.day, hits, onSelect, selectedId));
    }
  }
}

const DAY_HEADING = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/**
 * Which places are free on one night, and where to book them.
 *
 * Bookable places are listed in full — they are the ones that need a link and
 * can run out. First-come places are free every night by definition, so listing
 * all ~250 of them every time would bury the answer; they go behind a
 * disclosure with their count.
 */
function renderDayDetail(
  date: string,
  hits: Hit[],
  onSelect: (id: string) => void,
  selectedId: string | null,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "day-detail";

  const heading = document.createElement("h3");
  const night = nightIndex(date);
  heading.textContent = `${DAY_HEADING.format(new Date(`${date}T12:00:00Z`))} — the ${NIGHT_LABELS[night]} night`;
  section.append(heading);

  const bookable = hits.filter((hit) => hit.facility.availability === "calendar");
  const others = hits.filter((hit) => hit.facility.availability !== "calendar");

  if (bookable.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing bookable is free this night under the current filters.";
    section.append(empty);
  } else {
    const lead = document.createElement("p");
    lead.className = "detail-lead";
    lead.textContent = `${bookable.length} bookable place${bookable.length === 1 ? "" : "s"} free:`;
    section.append(lead);
    for (const { facility, nights } of bookable) {
      section.append(
        facilityCard(facility, nights, {
          selected: facility.shelter_id === selectedId,
          onSelect,
          highlightDate: date,
        }),
      );
    }
  }

  if (others.length > 0) {
    const disclosure = document.createElement("details");
    disclosure.className = "other-places";
    const summary = document.createElement("summary");
    summary.textContent = `${others.length} more that need no booking (or are booked elsewhere)`;
    disclosure.append(summary);
    for (const { facility, nights } of others) {
      disclosure.append(
        facilityCard(facility, nights, {
          selected: facility.shelter_id === selectedId,
          onSelect,
          highlightDate: date,
        }),
      );
    }
    section.append(disclosure);
  }

  return section;
}
