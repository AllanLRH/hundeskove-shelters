import type {
  Availability,
  Confidence,
  Dataset,
  DogForestProps,
  Facility,
  NightIndex,
  RawAvailability,
  RawFacility,
} from "./types";

const DATA_BASE = "./data";

/** Weekday of an ISO date as Monday=0 … Sunday=6. */
export function nightIndex(iso: string): NightIndex {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay(); // Sunday = 0
  return ((day + 6) % 7) as NightIndex;
}

/**
 * ISO-8601 week number (1-53).
 *
 * Weeks start Monday, matching the calendar's own Monday-first columns, and
 * week 1 is the week containing the year's first Thursday — equivalently, the
 * week containing 4 January. Computed by shifting to the Thursday of the same
 * week, which always falls in the correct ISO year, then counting whole weeks
 * from that year's own week 1.
 */
export function isoWeek(iso: string): number {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - weekday + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.round((thursday.getTime() - yearStart.getTime()) / 604_800_000) + 1;
}

export function eachDate(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${endIso}T12:00:00Z`);
  for (let t = Date.parse(`${startIso}T12:00:00Z`); t <= end; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function availabilityOf(raw: RawFacility): Availability {
  if (raw.booking_status === "naturstyrelsen") return "calendar";
  if (raw.booking_status === "other_operator") return "unknown";
  return "open";
}

function confidenceOf(raw: RawFacility): Confidence {
  if (raw.inside_polygon) {
    return raw.geofence_source === "osm" ? "inside_osm" : "inside";
  }
  if ((raw.overlap_fraction ?? 0) > 0) return "overlapping";
  if (!raw.dog_forest_has_boundary) return "marker_only";
  return "near";
}

function normalise(raw: RawFacility, horizon: string[]): Facility {
  const availability = availabilityOf(raw);
  // A first-come site needs no booking, so every night in the horizon is open.
  // An `unknown` site is booked through another system; we show it, but we
  // cannot claim any particular night, so it gets the horizon too and is
  // flagged rather than silently treated as free.
  const nights =
    availability === "calendar" ? raw.available_dates : horizon.slice();
  return {
    ...raw,
    availability,
    confidence: confidenceOf(raw),
    nights,
    nightIndices: nights.map(nightIndex),
  };
}

async function fetchJson<T>(name: string): Promise<T> {
  const response = await fetch(`${DATA_BASE}/${name}`);
  if (!response.ok) {
    throw new Error(
      `Could not load ${name} (${response.status}). Run \`just data\` to generate it.`,
    );
  }
  return (await response.json()) as T;
}

/** Pure half of loading, so it can be exercised without a browser. */
export function buildDataset(
  availability: RawAvailability,
  forests: Dataset["forests"],
): Dataset {
  const allDates = eachDate(
    availability.horizon_start,
    availability.horizon_end,
  );
  return {
    facilities: availability.shelters.map((raw) => normalise(raw, allDates)),
    horizonStart: availability.horizon_start,
    horizonEnd: availability.horizon_end,
    checkedAt: availability.checked_at,
    allDates,
    forests,
  };
}

export async function loadDataset(): Promise<Dataset> {
  const availability = await fetchJson<RawAvailability>("availability.json");

  // The map is still useful without outlines, so a missing GeoJSON is not fatal.
  let forests: Dataset["forests"] = null;
  try {
    forests = await fetchJson<
      GeoJSON.FeatureCollection<GeoJSON.Geometry, DogForestProps>
    >("dog_forests.geojson");
  } catch {
    forests = null;
  }

  return buildDataset(availability, forests);
}
