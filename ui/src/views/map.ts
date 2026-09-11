import L from "leaflet";
import type { Hit } from "../filters";
import {
  AVAILABILITY_LABEL,
  CONFIDENCE_LABEL,
  type Confidence,
  type Dataset,
} from "../types";

const CONFIDENCE_COLOUR: Record<Confidence, string> = {
  inside: "#1b7f3b",
  inside_osm: "#4f9d3a",
  overlapping: "#c98a00",
  near: "#2b6cb0",
  marker_only: "#8b5cf6",
};

/** Roughly Denmark, used when there is nothing to fit to. */
const DENMARK: L.LatLngBoundsExpression = [
  [54.5, 8.0],
  [57.8, 15.3],
];

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
    const map = L.map(this.container, { preferCanvas: true }).fitBounds(DENMARK);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    this.forests.addTo(map);
    this.markers.addTo(map);
    this.map = map;
    return map;
  }

  /**
   * Re-measure and re-fit after the container becomes visible.
   *
   * Leaflet reads the container size when it fits bounds, and a hidden tab has
   * no size, so fitting while hidden lands on a whole-world zoom. Measuring
   * first and only then re-fitting is what makes switching to the map tab show
   * the actual results.
   */
  refresh(): void {
    if (!this.map) return;
    this.map.invalidateSize();
    if (this.lastBounds) this.map.fitBounds(this.lastBounds.pad(0.15));
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

  render(hits: Hit[], selectedId: string | null): void {
    const map = this.ensureMap();
    this.markers.clearLayers();
    this.byId.clear();

    for (const { facility, nights } of hits) {
      const marker = L.circleMarker([facility.lat, facility.lon], {
        radius: facility.shelter_id === selectedId ? 11 : 7,
        color: CONFIDENCE_COLOUR[facility.confidence],
        weight: facility.shelter_id === selectedId ? 3 : 2,
        fillColor: CONFIDENCE_COLOUR[facility.confidence],
        // Hollow for anything without a real calendar, so certainty is visible
        // at a glance rather than only in the popup.
        fillOpacity: facility.availability === "calendar" ? 0.85 : 0.25,
      });
      marker.bindPopup(
        `<strong>${escapeHtml(facility.name || "(unnamed)")}</strong><br>` +
          `${escapeHtml(facility.facility_type)}<br>` +
          `${escapeHtml(CONFIDENCE_LABEL[facility.confidence])}<br>` +
          `${escapeHtml(AVAILABILITY_LABEL[facility.availability])} — ${nights.length} matching night(s)<br>` +
          `<a href="${facility.booking_url}" target="_blank" rel="noreferrer">Booking page</a>`,
      );
      marker.on("click", () => this.onSelect(facility.shelter_id));
      marker.addTo(this.markers);
      this.byId.set(facility.shelter_id, marker);
    }

    if (hits.length > 0) {
      this.lastBounds = L.latLngBounds(
        hits.map((hit) => [hit.facility.lat, hit.facility.lon] as [number, number]),
      );
      // Only fit while actually visible; refresh() handles the hidden case.
      if (this.container.clientWidth > 0) {
        map.fitBounds(this.lastBounds.pad(0.15));
      }
    }
  }

  focus(id: string): void {
    const marker = this.byId.get(id);
    if (!marker || !this.map) return;
    this.map.setView(marker.getLatLng(), Math.max(this.map.getZoom(), 13));
    marker.openPopup();
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
