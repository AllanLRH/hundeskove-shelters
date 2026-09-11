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

export function defaultFilters(data: Dataset): Filters {
  return {
    // Weekends on by default: the common case is "where can we go this weekend?"
    nights: new Set(WEEKEND_NIGHTS),
    availability: new Set<Availability>(["calendar", "open", "unknown"]),
    // marker_only is a genuinely weaker claim, so it stays off until asked for.
    confidence: new Set(CONFIDENCE_ORDER.filter((c) => c !== "marker_only")),
    facilityTypes: new Set(data.facilities.map((f) => f.facility_type)),
    maxDistance: 500,
    minOverlap: 0,
    from: data.horizonStart,
    to: data.horizonEnd,
    day: null,
  };
}

/** Nights of this facility that survive the night-type, range and day filters. */
export function matchingNights(facility: Facility, filters: Filters): string[] {
  const out: string[] = [];
  for (let i = 0; i < facility.nights.length; i += 1) {
    const date = facility.nights[i]!;
    if (date < filters.from || date > filters.to) continue;
    if (!filters.nights.has(facility.nightIndices[i]!)) continue;
    if (filters.day !== null && date !== filters.day) continue;
    out.push(date);
  }
  return out;
}

/** Everything except the night filters — used by the calendar, which counts nights. */
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

/** The single source of truth every view reads from. */
export function applyFilters(data: Dataset, filters: Filters): Hit[] {
  const hits: Hit[] = [];
  for (const facility of data.facilities) {
    if (!passesAttributes(facility, filters)) continue;
    const nights = matchingNights(facility, filters);
    if (nights.length === 0) continue;
    hits.push({ facility, nights });
  }
  const rank = new Map(CONFIDENCE_ORDER.map((c, i) => [c, i]));
  hits.sort(
    (a, b) =>
      rank.get(a.facility.confidence)! - rank.get(b.facility.confidence)! ||
      a.facility.distance_m - b.facility.distance_m ||
      a.facility.name.localeCompare(b.facility.name, "da"),
  );
  return hits;
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
  const types = [...filters.facilityTypes];
  const allTypes = new Set(data.facilities.map((f) => f.facility_type));
  if (types.length !== allTypes.size) params.set("t", types.join("|"));
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
