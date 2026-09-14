/**
 * Driving times from a home address, using OpenStreetMap's own services:
 * Nominatim to turn the address into a coordinate, OSRM to route from it.
 *
 * Both are the public demo instances, which are donated capacity with usage
 * policies attached — so this asks for as little as it can:
 *
 * * One geocode per address the user actually submits, never per keystroke.
 * * Durations for every facility come from OSRM's *table* service, which
 *   answers one-origin-to-many-destinations in a single request, rather than
 *   one /route call per shelter (338 requests).
 * * Results are cached per origin for the session, so panning the filters or
 *   reloading the page does not re-ask.
 *
 * The address is personal data and is treated as such: it is kept on this
 * machine (localStorage) and deliberately never written into the URL hash the
 * way the other filters are — a shared link would otherwise carry the sender's
 * home address to whoever opened it.
 */

import type { Facility } from "./types";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM_TABLE = "https://router.project-osrm.org/table/v1/driving/";

/**
 * Destinations per OSRM request. The public server currently answers far more
 * than this in one go, but `max-table-size` defaults to 100 and that is what
 * the service documents, so this stays inside the documented contract rather
 * than depending on the demo server's current generosity.
 */
const CHUNK = 100;

/** Cache key prefix; the address itself is stored separately and locally. */
const CACHE_PREFIX = "hundeskove:drive:";

export interface Origin {
  lat: number;
  lon: number;
  /** What Nominatim matched, so the user can see it picked the right place. */
  label: string;
}

export type TravelStatus = "idle" | "working" | "ready" | "error";

export interface TravelState {
  /** What the user typed, kept so the input survives panel re-renders. */
  query: string;
  origin: Origin | null;
  /** shelter_id -> driving seconds. Absent means OSRM could not route to it. */
  durations: Map<string, number>;
  status: TravelStatus;
  error: string | null;
  /** Human-readable progress while a multi-chunk routing run is in flight. */
  progress: string | null;
}

export function emptyTravel(): TravelState {
  return {
    query: storedAddress(),
    origin: null,
    durations: new Map(),
    status: "idle",
    error: null,
    progress: null,
  };
}

/** Turn a free-text address into a coordinate. Denmark-biased, since the data is. */
export async function geocode(query: string): Promise<Origin> {
  const url = `${NOMINATIM}?${new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "dk",
    addressdetails: "0",
  })}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Address lookup failed (${response.status}). Try again in a moment.`);
  }
  const results = (await response.json()) as { lat: string; lon: string; display_name: string }[];
  const first = results[0];
  if (!first) {
    throw new Error(`No Danish address found for “${query}”.`);
  }
  return {
    lat: Number(first.lat),
    lon: Number(first.lon),
    label: first.display_name,
  };
}

function cacheKey(origin: Origin): string {
  // ~11 m of precision is far finer than driving times resolve, and keeps the
  // key stable when Nominatim returns marginally different coordinates.
  return `${CACHE_PREFIX}${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}`;
}

function readCache(origin: Origin): Map<string, number> | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(origin));
    if (!raw) return null;
    return new Map(Object.entries(JSON.parse(raw) as Record<string, number>));
  } catch {
    return null;
  }
}

function writeCache(origin: Origin, durations: Map<string, number>): void {
  try {
    sessionStorage.setItem(cacheKey(origin), JSON.stringify(Object.fromEntries(durations)));
  } catch {
    // Quota or private browsing; the times still work, they just won't persist.
  }
}

/**
 * Driving seconds from `origin` to every facility.
 *
 * `onProgress` reports completed chunks so a long run can show progress rather
 * than appearing hung.
 */
export async function drivingDurations(
  origin: Origin,
  facilities: Facility[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, number>> {
  const cached = readCache(origin);
  if (cached) return cached;

  const durations = new Map<string, number>();
  const chunks: Facility[][] = [];
  for (let i = 0; i < facilities.length; i += CHUNK) {
    chunks.push(facilities.slice(i, i + CHUNK));
  }

  for (const [index, chunk] of chunks.entries()) {
    // Origin first, then this chunk's destinations; sources=0 asks for the
    // single row we care about rather than the full N x N matrix.
    const coords = [
      `${origin.lon},${origin.lat}`,
      ...chunk.map((f) => `${f.lon},${f.lat}`),
    ].join(";");
    const url = `${OSRM_TABLE}${coords}?sources=0&annotations=duration`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Routing failed (${response.status}). The public OSRM server may be busy.`);
    }
    const body = (await response.json()) as { code: string; durations?: (number | null)[][] };
    if (body.code !== "Ok" || !body.durations) {
      throw new Error(`Routing failed (${body.code}).`);
    }

    // Row 0 is the origin; its first entry is the origin-to-itself zero.
    const row = body.durations[0] ?? [];
    chunk.forEach((facility, i) => {
      const seconds = row[i + 1];
      // null means OSRM found no road route — an island or bad geometry.
      if (typeof seconds === "number") durations.set(facility.shelter_id, seconds);
    });

    onProgress?.(index + 1, chunks.length);
  }

  writeCache(origin, durations);
  return durations;
}

/** "1 h 12 min" / "38 min", from seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

// --- remembering the address, locally only --------------------------------- //

const ADDRESS_KEY = "hundeskove:address";

export function storedAddress(): string {
  try {
    return localStorage.getItem(ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberAddress(value: string): void {
  try {
    if (value.trim()) localStorage.setItem(ADDRESS_KEY, value.trim());
    else localStorage.removeItem(ADDRESS_KEY);
  } catch {
    // Not being able to remember it is not worth breaking the page for.
  }
}
