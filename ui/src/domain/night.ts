/**
 * Nights, named by the day you arrive.
 *
 * A booking runs 12:00 to 11:00 the next day, so a date in the availability
 * data *is* the night that starts on it: a Friday date is the fri–sat night.
 * That makes "which nights of the week" a plain weekday question, with no
 * pairing logic anywhere.
 */

/** An ISO date (YYYY-MM-DD) identifying the night that begins on it. */
export type Night = string;

/** Monday = 0 … Sunday = 6, matching NIGHT_LABELS and DAY_LABELS. */
export type NightIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const NIGHT_LABELS = [
  "mon–tue",
  "tue–wed",
  "wed–thu",
  "thu–fri",
  "fri–sat",
  "sat–sun",
  "sun–mon",
] as const;

/** Column headings for a Monday-first calendar: the arrival day. */
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** fri–sat and sat–sun. */
export const WEEKEND_NIGHTS: readonly NightIndex[] = [4, 5];

/**
 * Midday UTC, so a date is never dragged across a boundary by a timezone.
 *
 * Exported because formatting a night is the same problem: `Intl` on a
 * midnight-UTC date shows the day before to anyone west of Greenwich.
 */
export function at(night: Night): Date {
  return new Date(`${night}T12:00:00Z`);
}

/** Weekday of a night, as Monday=0 … Sunday=6. */
export function nightIndex(night: Night): NightIndex {
  return ((at(night).getUTCDay() + 6) % 7) as NightIndex;
}

/**
 * ISO-8601 week number (1-53).
 *
 * Weeks start Monday and week 1 is the one containing the year's first
 * Thursday. Computed by shifting to that Thursday, which always falls in the
 * correct ISO year — the detail a naive implementation gets wrong when
 * 1 January lands late in the week.
 */
export function isoWeek(night: Night): number {
  const date = at(night);
  const weekday = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - weekday + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.round((thursday.getTime() - yearStart.getTime()) / 604_800_000) + 1;
}

/** The span of nights the availability data covers. */
export interface Horizon {
  start: Night;
  end: Night;
}

/** Every night in a horizon, ascending. */
export function nightsIn(horizon: Horizon): Night[] {
  const nights: Night[] = [];
  const end = at(horizon.end).getTime();
  for (let t = at(horizon.start).getTime(); t <= end; t += 86_400_000) {
    nights.push(new Date(t).toISOString().slice(0, 10));
  }
  return nights;
}

/** Group nights into Monday-first weeks, padded with nulls at both ends. */
export function intoWeeks(nights: readonly Night[]): (Night | null)[][] {
  if (nights.length === 0) return [];
  const weeks: (Night | null)[][] = [];
  let row: (Night | null)[] = new Array(nightIndex(nights[0]!)).fill(null);
  for (const night of nights) {
    row.push(night);
    if (row.length === 7) {
      weeks.push(row);
      row = [];
    }
  }
  if (row.length > 0) weeks.push([...row, ...new Array(7 - row.length).fill(null)]);
  return weeks;
}
