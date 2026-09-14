/** The facts the app reasons over: facilities, the horizon, and when it was checked. */

import type { Facility } from "./facility";
import { nightsIn, type Horizon, type Night } from "./night";

export interface DogForestFeatureProps {
  id: string;
  name: string;
  geofence_source: "fkg" | "osm";
  has_boundary: boolean;
  matched: boolean;
}

export interface Dataset {
  facilities: readonly Facility[];
  horizon: Horizon;
  /** When availability was last refreshed; doubles as the dataset's revision. */
  checkedAt: string;
  /** Every night in the horizon, ascending. */
  nights: readonly Night[];
  /** Dog-forest outlines for the map. Absent is survivable; the map still works. */
  forests: GeoJSON.FeatureCollection<GeoJSON.Geometry, DogForestFeatureProps> | null;
}

export function makeDataset(
  facilities: readonly Facility[],
  horizon: Horizon,
  checkedAt: string,
  forests: Dataset["forests"] = null,
): Dataset {
  return { facilities, horizon, checkedAt, nights: nightsIn(horizon), forests };
}

export function facilityIds(dataset: Dataset): Set<string> {
  return new Set(dataset.facilities.map((f) => f.id));
}

export function facilityTypes(dataset: Dataset): string[] {
  return [...new Set(dataset.facilities.map((f) => f.type))].sort();
}
