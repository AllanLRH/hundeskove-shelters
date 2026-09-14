/** Fetching the generated files and turning them into a dataset. */

import type { Dataset } from "../domain/dataset";
import { parseDataset, type WireAvailability, type WireForests } from "./wire";

const DATA_BASE = "./data";

async function fetchJson<T>(name: string): Promise<T> {
  const response = await fetch(`${DATA_BASE}/${name}`);
  if (!response.ok) {
    throw new Error(
      `Could not load ${name} (${response.status}). Run \`just data\` to generate it.`,
    );
  }
  return (await response.json()) as T;
}

export async function loadDataset(): Promise<Dataset> {
  const availability = await fetchJson<WireAvailability>("availability.json");
  // The map is still useful without outlines, so a missing GeoJSON is not fatal.
  let forests: WireForests | null = null;
  try {
    forests = await fetchJson<WireForests>("dog_forests.geojson");
  } catch {
    forests = null;
  }
  return parseDataset(availability, forests);
}
