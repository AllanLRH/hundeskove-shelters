/**
 * Filters as a URL hash, so a view can be bookmarked or sent to someone.
 *
 * The home address is deliberately absent. The drive-time limit and sort order
 * are preferences and travel fine; the address they are relative to is personal
 * data, and a shared link carrying it would hand the sender's home to whoever
 * opened it. A link therefore arrives inert until the recipient enters an
 * address of their own.
 */

import type { AvailabilityKind, Confidence } from "./facility";
import type { Dataset } from "./dataset";
import { defaultFilters, MAX_DISTANCE_M, type Filters } from "./filters";
import type { NightIndex } from "./night";

export function toHash(filters: Filters, dataset: Dataset): string {
  const params = new URLSearchParams();
  params.set("n", [...filters.nights].sort().join(""));
  params.set("a", [...filters.availability].sort().join(","));
  params.set("c", [...filters.confidence].sort().join(","));
  if (filters.maxDistanceM !== MAX_DISTANCE_M) {
    params.set("d", String(filters.maxDistanceM));
  }
  if (filters.minOverlap > 0) params.set("o", String(filters.minOverlap));
  if (filters.from !== dataset.horizon.start) params.set("from", filters.from);
  if (filters.to !== dataset.horizon.end) params.set("to", filters.to);
  if (filters.night) params.set("day", filters.night);
  if (filters.maxDriveMinutes !== null) {
    params.set("drive", String(filters.maxDriveMinutes));
  }
  if (filters.sortBy !== "confidence") params.set("sort", filters.sortBy);
  // Always written. Omitting it when everything is selected was safe while the
  // default was "all types"; now that it is shelters only, an absent parameter
  // would silently narrow a link that had every type selected.
  params.set("t", [...filters.facilityTypes].join("|"));
  return params.toString();
}

export function fromHash(hash: string, dataset: Dataset): Filters {
  const filters = defaultFilters(dataset);
  if (!hash) return filters;
  const params = new URLSearchParams(hash.replace(/^#/, ""));

  const nights = params.get("n");
  if (nights !== null) {
    filters.nights = new Set(
      [...nights]
        .map((ch) => Number(ch) as NightIndex)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    );
  }
  const availability = params.get("a");
  if (availability) {
    filters.availability = new Set(availability.split(",") as AvailabilityKind[]);
  }
  const confidence = params.get("c");
  if (confidence) filters.confidence = new Set(confidence.split(",") as Confidence[]);
  const types = params.get("t");
  if (types) filters.facilityTypes = new Set(types.split("|"));
  const distance = params.get("d");
  if (distance) filters.maxDistanceM = Number(distance);
  const overlap = params.get("o");
  if (overlap) filters.minOverlap = Number(overlap);
  filters.from = params.get("from") ?? filters.from;
  filters.to = params.get("to") ?? filters.to;
  filters.night = params.get("day");
  const drive = params.get("drive");
  if (drive) filters.maxDriveMinutes = Number(drive);
  if (params.get("sort") === "drive") filters.sortBy = "drive";
  return filters;
}
