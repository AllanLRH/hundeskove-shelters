/** Driving times from one origin to many destinations, via OSRM. */

import type { Coordinates } from "../domain/facility";
import { TravelTimes, type Origin } from "../domain/travel";

export interface Destination {
  id: string;
  position: Coordinates;
}

export interface Router {
  drivingTimes(
    origin: Origin,
    destinations: readonly Destination[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<TravelTimes>;
}

const OSRM_TABLE = "https://router.project-osrm.org/table/v1/driving/";

/**
 * Destinations per request. The public server currently answers far more than
 * this in one go, but `max-table-size` defaults to 100 and that is what the
 * service documents, so this stays inside the documented contract rather than
 * relying on the demo server's present generosity.
 */
const CHUNK = 100;

/**
 * Uses OSRM's *table* service, which answers one-origin-to-many-destinations
 * in a single request. The alternative — one /route call per facility — would
 * be 338 requests against donated capacity for the same answer.
 */
export class OsrmRouter implements Router {
  async drivingTimes(
    origin: Origin,
    destinations: readonly Destination[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<TravelTimes> {
    const entries: [string, number][] = [];
    const chunks: Destination[][] = [];
    for (let i = 0; i < destinations.length; i += CHUNK) {
      chunks.push(destinations.slice(i, i + CHUNK));
    }

    for (const [index, chunk] of chunks.entries()) {
      // Origin first, then this chunk; sources=0 asks for the single row we
      // care about rather than the full N x N matrix.
      const coords = [
        `${origin.lon},${origin.lat}`,
        ...chunk.map((d) => `${d.position.lon},${d.position.lat}`),
      ].join(";");

      const response = await fetch(`${OSRM_TABLE}${coords}?sources=0&annotations=duration`);
      if (!response.ok) {
        throw new Error(
          `Routing failed (${response.status}). The public OSRM server may be busy.`,
        );
      }
      const body = (await response.json()) as {
        code: string;
        durations?: (number | null)[][];
      };
      if (body.code !== "Ok" || !body.durations) {
        throw new Error(`Routing failed (${body.code}).`);
      }

      const row = body.durations[0] ?? [];
      chunk.forEach((destination, i) => {
        const seconds = row[i + 1];
        // null means OSRM found no road route — an island, or bad geometry.
        if (typeof seconds === "number") entries.push([destination.id, seconds]);
      });
      onProgress?.(index + 1, chunks.length);
    }

    return TravelTimes.fromSeconds(entries);
  }
}
