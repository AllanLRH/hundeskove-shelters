/** Shapes mirroring what the Python pipeline writes into `output/`. */

/** One row of `output/availability.json`, exactly as written. */
export interface RawFacility {
  shelter_id: string;
  name: string;
  facility_type: string;
  umb_id: number;
  description: string;
  dog_forest_name: string;
  dog_forest_id: string;
  distance_m: number;
  inside_polygon: boolean;
  overlap_fraction: number | null;
  dog_forest_has_boundary: boolean;
  geofence_source: "fkg" | "osm";
  commune_code: number;
  org: string;
  bookable: boolean;
  place_id: number | null;
  booking_status: "naturstyrelsen" | "not_bookable" | "other_operator";
  booking_url: string;
  lat: number;
  lon: number;
  n_available: number;
  available_dates: string[];
}

export interface RawAvailability {
  checked_at: string;
  horizon_start: string;
  horizon_end: string;
  shelters: RawFacility[];
}

/**
 * How much we know about when a place is free.
 *
 * Crucially `open` is not "no availability": 244 of 338 facilities are
 * free/first-come and need no booking at all, so they are available every
 * night. Only `calendar` facilities have real dates.
 */
export type Availability = "calendar" | "open" | "unknown";

/**
 * How confident we are that the facility really is in an off-leash forest.
 * Ordered from strongest to weakest claim.
 */
export type Confidence =
  | "inside"
  | "inside_osm"
  | "overlapping"
  | "near"
  | "marker_only";

export const CONFIDENCE_ORDER: Confidence[] = [
  "inside",
  "inside_osm",
  "overlapping",
  "near",
  "marker_only",
];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  inside: "Inside (official boundary)",
  inside_osm: "Inside (OSM boundary)",
  overlapping: "Overlaps the dog forest",
  near: "Near the boundary",
  marker_only: "Marker only — distance unreliable",
};

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  calendar: "Bookable",
  open: "Free / first-come",
  unknown: "Booked elsewhere",
};

/**
 * Night types, indexed by the weekday of the *arrival* date.
 *
 * A booking runs 12:00 on day D to 11:00 on D+1, so a date in `available_dates`
 * is the night D→D+1 and its weekday names the night: a Friday date is the
 * friday–saturday night.
 */
export const NIGHT_LABELS = [
  "mon–tue",
  "tue–wed",
  "wed–thu",
  "thu–fri",
  "fri–sat",
  "sat–sun",
  "sun–mon",
] as const;

/**
 * Weekday of arrival, Monday-first — the Danish/ISO week, which runs Monday to
 * Sunday. Used for the calendar's column headers, where a bare day name reads
 * more naturally than a night pair: the "Fri" column is Friday night, i.e. the
 * fri–sat night.
 */
export const DAY_LABELS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/** Monday = 0 … Sunday = 6, matching NIGHT_LABELS and DAY_LABELS. */
export type NightIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** fri–sat and sat–sun. */
export const WEEKEND_NIGHTS: NightIndex[] = [4, 5];

export interface Facility extends RawFacility {
  availability: Availability;
  confidence: Confidence;
  /** ISO dates this place is free, already expanded for `open` facilities. */
  nights: string[];
  /** Same nights as weekday indices, parallel to `nights`. */
  nightIndices: NightIndex[];
}

export interface DogForestProps {
  id: string;
  name: string;
  geofence_source: "fkg" | "osm";
  has_boundary: boolean;
  matched: boolean;
}

export interface Dataset {
  facilities: Facility[];
  horizonStart: string;
  horizonEnd: string;
  checkedAt: string;
  /** Every date in the horizon, ISO, ascending. */
  allDates: string[];
  forests: GeoJSON.FeatureCollection<GeoJSON.Geometry, DogForestProps> | null;
}
