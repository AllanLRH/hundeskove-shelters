/** Turning an address into a coordinate, via OpenStreetMap's Nominatim. */

import type { Origin } from "../domain/travel";

export interface Geocoder {
  lookUp(query: string): Promise<Origin>;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/**
 * Nominatim is donated capacity with a usage policy, so this is called once
 * per address the user actually submits — never per keystroke.
 */
export class NominatimGeocoder implements Geocoder {
  async lookUp(query: string): Promise<Origin> {
    const url = `${NOMINATIM}?${new URLSearchParams({
      q: query,
      format: "json",
      limit: "1",
      // The data is Danish; biasing the search avoids matching a same-named
      // street on the other side of the world.
      countrycodes: "dk",
      addressdetails: "0",
    })}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Address lookup failed (${response.status}). Try again in a moment.`);
    }
    const results = (await response.json()) as NominatimResult[];
    const first = results[0];
    if (!first) throw new Error(`No Danish address found for “${query}”.`);
    return { lat: Number(first.lat), lon: Number(first.lon), label: first.display_name };
  }
}
