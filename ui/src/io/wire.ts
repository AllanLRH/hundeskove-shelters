/**
 * The boundary between the generated files and the domain.
 *
 * This module is the *only* place that knows the output's field names. They
 * read as `shelter_id`, `dog_forest_name`, `n_available` and so on for
 * historical reasons — the project began as a shelter finder before it covered
 * four facility categories — and are deliberately frozen so existing links and
 * scripts keep working. Everything past this file speaks the domain instead.
 */

import {
  makeDataset,
  type Dataset,
  type DogForestFeatureProps,
} from "../domain/dataset";
import type { Availability, Facility } from "../domain/facility";
import type { Horizon } from "../domain/night";

/** One row of `output/availability.json`, exactly as written. */
export interface WireFacility {
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
  region: number;
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

export interface WireAvailability {
  checked_at: string;
  horizon_start: string;
  horizon_end: string;
  shelters: WireFacility[];
}

export type WireForests = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  DogForestFeatureProps
>;

/**
 * `booking_status` says who takes the booking; availability says when the
 * place is free. Only Naturstyrelsen exposes a calendar, so only those rows
 * carry real dates — the other two are *not* "never free", which is exactly
 * the confusion the domain union exists to prevent.
 */
function parseAvailability(raw: WireFacility): Availability {
  switch (raw.booking_status) {
    case "naturstyrelsen":
      return { kind: "bookable", freeNights: raw.available_dates };
    case "other_operator":
      return { kind: "unknown" };
    default:
      return { kind: "open" };
  }
}

export function parseFacility(raw: WireFacility): Facility {
  return {
    id: raw.shelter_id,
    name: raw.name,
    type: raw.facility_type,
    categoryId: raw.umb_id,
    description: raw.description,
    position: { lat: raw.lat, lon: raw.lon },
    region: raw.region,
    communeCode: raw.commune_code,
    operator: raw.org,
    proximity: {
      forest: {
        id: raw.dog_forest_id,
        name: raw.dog_forest_name,
        hasBoundary: raw.dog_forest_has_boundary,
        source: raw.geofence_source,
      },
      distanceM: raw.distance_m,
      insidePolygon: raw.inside_polygon,
      overlapFraction: raw.overlap_fraction,
    },
    availability: parseAvailability(raw),
    booking: { url: raw.booking_url, placeId: raw.place_id },
  };
}

export function parseDataset(
  availability: WireAvailability,
  forests: WireForests | null = null,
): Dataset {
  const horizon: Horizon = {
    start: availability.horizon_start,
    end: availability.horizon_end,
  };
  return makeDataset(
    availability.shelters.map(parseFacility),
    horizon,
    availability.checked_at,
    forests,
  );
}
