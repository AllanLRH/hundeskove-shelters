import type { Hit } from "../filters";
import { AVAILABILITY_LABEL, CONFIDENCE_LABEL, type Facility } from "../types";

function proximity(facility: Facility): string {
  if (facility.inside_polygon) return "inside";
  if (facility.overlap_fraction) {
    return `${(facility.overlap_fraction * 100).toFixed(1)}% overlap`;
  }
  const distance = `${Math.round(facility.distance_m)} m`;
  return facility.dog_forest_has_boundary ? distance : `~${distance} to marker`;
}

export function renderList(
  root: HTMLElement,
  hits: Hit[],
  selectedId: string | null,
  onSelect: (id: string) => void,
): void {
  root.replaceChildren();
  if (hits.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing matches these filters. Try more nights, or a larger distance.";
    root.append(empty);
    return;
  }

  for (const { facility, nights } of hits) {
    const row = document.createElement("article");
    row.className = "card";
    row.dataset.id = facility.shelter_id;
    if (facility.shelter_id === selectedId) row.classList.add("selected");
    row.tabIndex = 0;

    const title = document.createElement("h3");
    title.textContent = facility.name || "(unnamed)";
    const type = document.createElement("span");
    type.className = "type";
    type.textContent = facility.facility_type;
    title.append(type);

    const forest = document.createElement("p");
    forest.className = "forest";
    forest.textContent = facility.dog_forest_name
      ? `${proximity(facility)} — ${facility.dog_forest_name}`
      : proximity(facility);

    const badges = document.createElement("p");
    badges.className = "badges";
    const confidence = document.createElement("span");
    confidence.className = `badge conf-${facility.confidence}`;
    confidence.textContent = CONFIDENCE_LABEL[facility.confidence];
    const availability = document.createElement("span");
    availability.className = `badge avail-${facility.availability}`;
    availability.textContent = AVAILABILITY_LABEL[facility.availability];
    const count = document.createElement("span");
    count.className = "badge nights";
    count.textContent =
      facility.availability === "calendar"
        ? `${nights.length} night${nights.length === 1 ? "" : "s"} free`
        : `${nights.length} matching night${nights.length === 1 ? "" : "s"}`;
    badges.append(confidence, availability, count);

    row.append(title, forest, badges);

    if (facility.description) {
      const description = document.createElement("p");
      description.className = "description";
      description.textContent = facility.description;
      row.append(description);
    }

    if (facility.availability === "calendar" && nights.length > 0) {
      const dates = document.createElement("p");
      dates.className = "dates";
      dates.textContent = nights.slice(0, 8).join(", ") + (nights.length > 8 ? " …" : "");
      row.append(dates);
    }

    const links = document.createElement("p");
    links.className = "links";
    const booking = document.createElement("a");
    booking.href = facility.booking_url;
    booking.target = "_blank";
    booking.rel = "noreferrer";
    booking.textContent =
      facility.availability === "open" ? "Details" : "Booking page";
    const map = document.createElement("a");
    map.href = `https://www.openstreetmap.org/?mlat=${facility.lat}&mlon=${facility.lon}#map=16/${facility.lat}/${facility.lon}`;
    map.target = "_blank";
    map.rel = "noreferrer";
    map.textContent = "Open in OSM";
    links.append(booking, map);
    row.append(links);

    row.addEventListener("click", () => onSelect(facility.shelter_id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(facility.shelter_id);
      }
    });
    root.append(row);
  }
}
