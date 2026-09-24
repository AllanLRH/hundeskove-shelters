import L from "leaflet";
import type { Match } from "../domain/search";
import { confidenceOf, type Confidence } from "../domain/facility";
import type { Dataset } from "../domain/dataset";

// Markers sit on light map tiles in both themes (dark mode only dims them),
// so these stay the light-palette semantic hues from styles.css.
const CONFIDENCE_COLOUR: Record<Confidence, string> = {
  inside: "#18794e",
  inside_osm: "#4a8f34",
  overlapping: "#a8720a",
  near: "#3451b2",
  marker_only: "#7c4dd1",
};

/**
 * Copenhagen, the default view.
 *
 * Fitting all 338 matches spans the whole country, which zooms out far enough
 * that the dog-forest outlines — the thing the map exists to show — are smaller
 * than a pixel. Starting local and letting "Fit to results" zoom out on demand
 * is far more useful than the reverse.
 */
const COPENHAGEN: L.LatLngExpression = [55.6761, 12.5683];
const DEFAULT_ZOOM = 11;

/**
 * Where the basemap comes from.
 *
 * OSM's own tile servers are donated capacity with a
 * [usage policy](https://operations.osmfoundation.org/policies/tiles/) that
 * forbids heavy use and names "distributing an app that uses tiles from
 * openstreetmap.org" as needing prior permission. A map session pulls a few
 * hundred tiles, and unlike everything else this project fetches, that cost
 * scales with the number of visitors rather than being amortised across them.
 *
 * Fine for a personal or small-audience instance; the first thing to change if
 * one gets popular. Point `TILE_URL` at a self-hosted renderer or a provider
 * whose terms cover public apps, and update `TILE_ATTRIBUTION` to match — that
 * is the whole of the change.
 */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "© OpenStreetMap contributors";

export class MapView {
  private map: L.Map | null = null;
  private markers = L.layerGroup();
  private forests = L.layerGroup();
  private byId = new Map<string, L.CircleMarker>();
  private lastBounds: L.LatLngBounds | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (id: string) => void,
  ) {}

  private ensureMap(): L.Map {
    if (this.map) return this.map;
    const map = L.map(this.container, { preferCanvas: true }).setView(
      COPENHAGEN,
      DEFAULT_ZOOM,
    );
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    this.forests.addTo(map);
    this.markers.addTo(map);
    this.map = map;
    return map;
  }

  /**
   * Re-measure after the container becomes visible.
   *
   * Leaflet reads the container size lazily, and a hidden tab has no size, so a
   * map created or moved while hidden renders wrong until told to re-measure.
   */
  refresh(): void {
    this.map?.invalidateSize();
  }

  /** Zoom out to cover everything currently matching. */
  fitToResults(): void {
    if (this.map && this.lastBounds) this.map.fitBounds(this.lastBounds.pad(0.15));
  }

  /** Back to the default local view. */
  home(): void {
    this.map?.setView(COPENHAGEN, DEFAULT_ZOOM);
  }

  drawForests(data: Dataset): void {
    if (!data.forests) return;
    this.ensureMap();
    this.forests.clearLayers();
    L.geoJSON(data.forests, {
      style: (feature) => {
        const matched = feature?.properties?.matched === true;
        const osm = feature?.properties?.geofence_source === "osm";
        return {
          color: osm ? "#4f9d3a" : "#1b7f3b",
          weight: matched ? 2 : 1,
          opacity: matched ? 0.9 : 0.35,
          fillOpacity: matched ? 0.18 : 0.06,
          dashArray: osm ? "4 3" : undefined,
        };
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        layer.bindTooltip(
          props.geofence_source === "osm"
            ? `${props.name} (boundary from OpenStreetMap)`
            : props.name,
        );
      },
      // Marker-only forests have no outline worth drawing.
      filter: (feature) => feature.properties?.has_boundary === true,
    }).addTo(this.forests);
  }

  render(matches: readonly Match[], selectedId: string | null): void {
    this.ensureMap();
    this.markers.clearLayers();
    this.byId.clear();

    for (const { facility } of matches) {
      const marker = L.circleMarker([facility.position.lat, facility.position.lon], {
        radius: facility.id === selectedId ? 11 : 7,
        color: CONFIDENCE_COLOUR[confidenceOf(facility.proximity)],
        weight: facility.id === selectedId ? 3 : 2,
        fillColor: CONFIDENCE_COLOUR[confidenceOf(facility.proximity)],
        // Hollow for anything without a real calendar, so availability is
        // visible at a glance and not only after clicking.
        fillOpacity: facility.availability.kind === "bookable" ? 0.85 : 0.25,
      });
      // A tooltip names the marker on hover; the full detail — which nights and
      // where to book — goes in the panel below, where it has room to breathe
      // and matches what the list and calendar show.
      marker.bindTooltip(facility.name || "(unnamed)");
      marker.on("click", () => this.onSelect(facility.id));
      marker.addTo(this.markers);
      this.byId.set(facility.id, marker);
    }

    // Deliberately does not move the map. Re-fitting on every filter change
    // yanks the view away mid-browse, and fitting all results zooms out past
    // the point where the dog-forest outlines are legible.
    this.lastBounds =
      matches.length > 0
        ? L.latLngBounds(
            matches.map((m) => [m.facility.position.lat, m.facility.position.lon] as [number, number]),
          )
        : null;
  }

  focus(id: string): void {
    const marker = this.byId.get(id);
    if (!marker || !this.map) return;
    this.map.setView(marker.getLatLng(), Math.max(this.map.getZoom(), 13));
  }
}
