import { nightIndex } from "../data";
import { passesAttributes, type Filters } from "../filters";
import { NIGHT_LABELS, type Dataset } from "../types";

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
  onPickDay: (date: string | null) => void,
): void {
  root.replaceChildren();
  const counts = countNights(data, filters);

  const legend = document.createElement("p");
  legend.className = "cal-legend";
  legend.textContent =
    "Each cell is a night. Top number: bookable places free. Bottom: free/first-come places matching.";
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
    for (const label of NIGHT_LABELS) {
      const head = document.createElement("div");
      head.className = "cal-head";
      head.textContent = label;
      grid.append(head);
    }

    // Pad so the first night lands under its weekday column.
    for (let i = 0; i < nightIndex(dates[0]!); i += 1) {
      grid.append(document.createElement("div"));
    }

    for (const date of dates) {
      const night = nightIndex(date);
      const entry = counts.get(date)!;
      const cell = document.createElement("button");
      cell.className = "cal-cell";
      // Dimmed rather than hidden, so the weekend pattern stays readable.
      if (!filters.nights.has(night)) cell.classList.add("dimmed");
      if (date < filters.from || date > filters.to) cell.classList.add("dimmed");
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
    section.append(grid);
    root.append(section);
  }
}
