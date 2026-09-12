import {
  CONFIDENCE_ORDER,
  WEEKEND_NIGHTS,
  type Availability,
  type Confidence,
  type Dataset,
  type Facility,
  type NightIndex,
} from "./types";

export interface Filters {
  nights: Set<NightIndex>;
  availability: Set<Availability>;
  confidence: Set<Confidence>;
  facilityTypes: Set<string>;
  maxDistance: number;
  minOverlap: number;
  from: string;
  to: string;
  /** Set when a calendar day is clicked, narrowing every view to that night. */
  day: string | null;
}

/**
 * Tiers shown before you ask for more.
 *
 * `near` and `marker_only` are both weaker claims than the name suggests: the
 * first is merely close to a boundary rather than inside one, the second has no
 * mapped boundary at all. Starting with only the places actually in a dog forest
 * keeps the default answer trustworthy; both tiers are one checkbox away.
 */
const DEFAULT_CONFIDENCE: Confidence[] = CONFIDENCE_ORDER.filter(
  (tier) => tier !== "near" && tier !== "marker_only",
);

/** Shelters are the thing people usually mean; the other categories opt in. */
const DEFAULT_FACILITY_TYPES = ["Shelter"];

export function defaultFilters(data: Dataset): Filters {
  const available = new Set(data.facilities.map((f) => f.facility_type));
  const types = DEFAULT_FACILITY_TYPES.filter((type) => available.has(type));
  return {
    // Weekends on by default: the common case is "where can we go this weekend?"
    nights: new Set(WEEKEND_NIGHTS),
    availability: new Set<Availability>(["calendar", "open", "unknown"]),
    confidence: new Set(DEFAULT_CONFIDENCE),
    // Fall back to everything if this dataset has no shelters at all, so a run
    // with `--categories 1111` is not silently empty on first load.
    facilityTypes: new Set(types.length > 0 ? types : available),
    maxDistance: 500,
    minOverlap: 0,
    from: data.horizonStart,
    to: data.horizonEnd,
    day: null,
  };
}

/**
 * Nights of this facility that survive the day filter, and — unless told to
 * skip them — the night-of-week and date-range filters too.
 *
 * The calendar view deliberately skips those two: its whole purpose is to
 * show every night across the full horizon regardless of which nights or
 * dates the list and map are currently narrowed to, so clicking a cell the
 * list has filtered away should still show what is actually free that night
 * rather than an empty result. `filters.day` is a different thing — it is the
 * calendar's own click-to-narrow interaction, not one of the two excluded
 * filters, so it still applies in both modes.
 */
export function matchingNights(
  facility: Facility,
  filters: Filters,
  { respectNightAndRange = true }: { respectNightAndRange?: boolean } = {},
): string[] {
  const out: string[] = [];
  for (let i = 0; i < facility.nights.length; i += 1) {
    const date = facility.nights[i]!;
    if (respectNightAndRange) {
      if (date < filters.from || date > filters.to) continue;
      if (!filters.nights.has(facility.nightIndices[i]!)) continue;
    }
    if (filters.day !== null && date !== filters.day) continue;
    out.push(date);
  }
  return out;
}

/** Every filter except the ones about *when*: availability, certainty, type, proximity. */
export function passesAttributes(facility: Facility, filters: Filters): boolean {
  if (!filters.availability.has(facility.availability)) return false;
  if (!filters.confidence.has(facility.confidence)) return false;
  if (!filters.facilityTypes.has(facility.facility_type)) return false;
  if (facility.distance_m > filters.maxDistance) return false;
  if (filters.minOverlap > 0) {
    if ((facility.overlap_fraction ?? 0) < filters.minOverlap) return false;
  }
  return true;
}

export interface Hit {
  facility: Facility;
  nights: string[];
}

function sortHits(hits: Hit[]): Hit[] {
  const rank = new Map(CONFIDENCE_ORDER.map((c, i) => [c, i]));
  return hits.sort(
    (a, b) =>
      rank.get(a.facility.confidence)! - rank.get(b.facility.confidence)! ||
      a.facility.distance_m - b.facility.distance_m ||
      a.facility.name.localeCompare(b.facility.name, "da"),
  );
}

/** The list and map read from this. */
export function applyFilters(data: Dataset, filters: Filters): Hit[] {
  const hits: Hit[] = [];
  for (const facility of data.facilities) {
    if (!passesAttributes(facility, filters)) continue;
    const nights = matchingNights(facility, filters);
    if (nights.length === 0) continue;
    hits.push({ facility, nights });
  }
  return sortHits(hits);
}

/**
 * The calendar's day-detail reads from this instead of `applyFilters`: same
 * result, minus the night-of-week and date-range narrowing.
 */
export function applyCalendarFilters(data: Dataset, filters: Filters): Hit[] {
  const hits: Hit[] = [];
  for (const facility of data.facilities) {
    if (!passesAttributes(facility, filters)) continue;
    const nights = matchingNights(facility, filters, { respectNightAndRange: false });
    if (nights.length === 0) continue;
    hits.push({ facility, nights });
  }
  return sortHits(hits);
}

// --- URL hash round-trip, so a filtered view can be linked or reloaded ------ //

export function toHash(filters: Filters, data: Dataset): string {
  const params = new URLSearchParams();
  params.set("n", [...filters.nights].sort().join(""));
  params.set("a", [...filters.availability].sort().join(","));
  params.set("c", [...filters.confidence].sort().join(","));
  if (filters.maxDistance !== 500) params.set("d", String(filters.maxDistance));
  if (filters.minOverlap > 0) params.set("o", String(filters.minOverlap));
  if (filters.from !== data.horizonStart) params.set("from", filters.from);
  if (filters.to !== data.horizonEnd) params.set("to", filters.to);
  if (filters.day) params.set("day", filters.day);
  // Always written. Omitting it when everything is selected used to be safe,
  // because "no t" and "all types" meant the same thing; now the default is
  // shelters only, so an omitted t would silently narrow a link that had every
  // type selected.
  params.set("t", [...filters.facilityTypes].join("|"));
  return params.toString();
}

export function fromHash(hash: string, data: Dataset): Filters {
  const filters = defaultFilters(data);
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!hash) return filters;

  const nights = params.get("n");
  if (nights !== null) {
    filters.nights = new Set(
      [...nights].map((ch) => Number(ch) as NightIndex).filter((n) => n >= 0 && n <= 6),
    );
  }
  const availability = params.get("a");
  if (availability) {
    filters.availability = new Set(availability.split(",") as Availability[]);
  }
  const confidence = params.get("c");
  if (confidence) {
    filters.confidence = new Set(confidence.split(",") as Confidence[]);
  }
  const types = params.get("t");
  if (types) filters.facilityTypes = new Set(types.split("|"));
  const distance = params.get("d");
  if (distance) filters.maxDistance = Number(distance);
  const overlap = params.get("o");
  if (overlap) filters.minOverlap = Number(overlap);
  filters.from = params.get("from") ?? filters.from;
  filters.to = params.get("to") ?? filters.to;
  filters.day = params.get("day");
  return filters;
}
