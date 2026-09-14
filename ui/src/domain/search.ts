/**
 * Turning a dataset plus filters into results.
 *
 * Two entry points on purpose. The list and map narrow by *when* as well as
 * *what*; the calendar deliberately does not, because its whole job is to show
 * the pattern across the full horizon. Narrowing it the same way would make
 * clicking a night the list had filtered away open an empty detail panel.
 */

import { CONFIDENCE_ORDER, confidenceOf, freeNights, type Facility } from "./facility";
import type { Dataset } from "./dataset";
import { matchesAttributes, matchesNight, type Filters } from "./filters";
import { nightIndex, type Night } from "./night";
import { TravelTimes } from "./travel";

/** A facility together with the nights of it that survived the filters. */
export interface Match {
  facility: Facility;
  nights: readonly Night[];
}

const CONFIDENCE_RANK = new Map(CONFIDENCE_ORDER.map((tier, i) => [tier, i]));

function byConfidence(a: Match, b: Match): number {
  return (
    CONFIDENCE_RANK.get(confidenceOf(a.facility.proximity))! -
      CONFIDENCE_RANK.get(confidenceOf(b.facility.proximity))! ||
    a.facility.proximity.distanceM - b.facility.proximity.distanceM ||
    a.facility.name.localeCompare(b.facility.name, "da")
  );
}

function sortMatches(matches: Match[], filters: Filters, travel: TravelTimes): Match[] {
  if (filters.sortBy !== "drive" || !travel.known) return matches.sort(byConfidence);
  // Unroutable facilities sort last, not first — which is what comparing a bare
  // `undefined` would have done.
  const seconds = (match: Match): number =>
    travel.get(match.facility.id) ?? Number.POSITIVE_INFINITY;
  return matches.sort((a, b) => seconds(a) - seconds(b) || byConfidence(a, b));
}

function search(
  dataset: Dataset,
  filters: Filters,
  travel: TravelTimes,
  respectNightAndRange: boolean,
): Match[] {
  const matches: Match[] = [];
  for (const facility of dataset.facilities) {
    if (!matchesAttributes(facility, filters, travel)) continue;
    const nights = freeNights(facility.availability, dataset.nights).filter((night) =>
      matchesNight(night, nightIndex(night), filters, { respectNightAndRange }),
    );
    if (nights.length === 0) continue;
    matches.push({ facility, nights });
  }
  return sortMatches(matches, filters, travel);
}

/** What the list and the map show: every filter applies. */
export function findMatches(
  dataset: Dataset,
  filters: Filters,
  travel: TravelTimes = TravelTimes.empty(),
): Match[] {
  return search(dataset, filters, travel, true);
}

/** What the calendar shows: the same, minus the night-of-week and date range. */
export function findCalendarMatches(
  dataset: Dataset,
  filters: Filters,
  travel: TravelTimes = TravelTimes.empty(),
): Match[] {
  return search(dataset, filters, travel, false);
}

export interface NightTally {
  /** Places with a real calendar that are free this night. */
  bookable: number;
  /** Places that need no booking, so are free every night. */
  open: number;
}

/**
 * How many places are free on each night of the horizon.
 *
 * Bookable and first-come are counted apart because the first-come figure is a
 * near-constant: a single total would be dominated by it and the interesting
 * signal — which nights are still actually bookable — would vanish.
 */
export function tallyNights(
  dataset: Dataset,
  filters: Filters,
  travel: TravelTimes = TravelTimes.empty(),
): Map<Night, NightTally> {
  const tally = new Map<Night, NightTally>();
  for (const night of dataset.nights) tally.set(night, { bookable: 0, open: 0 });

  for (const facility of dataset.facilities) {
    // Drive time belongs here too: it filters which *places* qualify, not which
    // nights, so unlike Nights and Dates it does reach the calendar. Leaving it
    // out would make a cell's count disagree with the detail it opens.
    if (!matchesAttributes(facility, filters, travel)) continue;
    for (const night of freeNights(facility.availability, dataset.nights)) {
      const entry = tally.get(night);
      if (!entry) continue;
      if (facility.availability.kind === "bookable") entry.bookable += 1;
      else entry.open += 1;
    }
  }
  return tally;
}

/** Split a night's matches into the ones you must book and the rest. */
export function splitByBookability(matches: readonly Match[]): {
  bookable: Match[];
  others: Match[];
} {
  return {
    bookable: matches.filter((m) => m.facility.availability.kind === "bookable"),
    others: matches.filter((m) => m.facility.availability.kind !== "bookable"),
  };
}
