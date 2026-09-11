import { AVAILABILITY_LABEL, CONFIDENCE_LABEL, type Facility } from "../types";

/** How the facility sits relative to its dog forest, in one phrase. */
export function proximity(facility: Facility): string {
  if (facility.inside_polygon) return "inside";
  if (facility.overlap_fraction) {
    return `${(facility.overlap_fraction * 100).toFixed(1)}% overlap`;
  }
  const distance = `${Math.round(facility.distance_m)} m`;
  return facility.dog_forest_has_boundary ? distance : `~${distance} to marker`;
}

export interface CardOptions {
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Dates beyond this are summarised rather than listed. Infinity lists all. */
  maxDates?: number;
  /** Rendered with emphasis, e.g. the night picked in the calendar. */
  highlightDate?: string | null;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatNight(iso: string): string {
  return DATE_FORMAT.format(new Date(`${iso}T12:00:00Z`));
}

/**
 * One facility, rendered identically wherever it appears.
 *
 * The list, the calendar's day detail and the map's selection all use this, so
 * "which places, and where do I book them" reads the same in all three.
 */
export function facilityCard(
  facility: Facility,
  nights: string[],
  options: CardOptions = {},
): HTMLElement {
  const { selected = false, onSelect, maxDates = 8, highlightDate = null } = options;

  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = facility.shelter_id;
  if (selected) card.classList.add("selected");
  if (onSelect) card.tabIndex = 0;

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
  badges.append(confidence, availability);

  if (facility.availability === "calendar") {
    const count = document.createElement("span");
    count.className = "badge nights";
    count.textContent = `${nights.length} night${nights.length === 1 ? "" : "s"} free`;
    badges.append(count);
  }

  card.append(title, forest, badges);

  if (facility.description) {
    const description = document.createElement("p");
    description.className = "description";
    description.textContent = facility.description;
    card.append(description);
  }

  card.append(nightsBlock(facility, nights, maxDates, highlightDate));
  card.append(linksBlock(facility));

  if (onSelect) {
    card.addEventListener("click", (event) => {
      // Let the booking link do its own thing.
      if ((event.target as HTMLElement).closest("a")) return;
      onSelect(facility.shelter_id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(facility.shelter_id);
      }
    });
  }
  return card;
}

function nightsBlock(
  facility: Facility,
  nights: string[],
  maxDates: number,
  highlightDate: string | null,
): HTMLElement {
  const block = document.createElement("p");
  block.className = "dates";

  if (facility.availability === "open") {
    block.classList.add("note");
    block.textContent = "No booking needed — turn up any night.";
    return block;
  }
  if (facility.availability === "unknown") {
    block.classList.add("note");
    block.textContent =
      "Booked through another system, so we cannot see which nights are free.";
    return block;
  }

  if (nights.length === 0) {
    block.classList.add("note");
    block.textContent = "No free nights in the current filters.";
    return block;
  }

  const shown = nights.slice(0, maxDates);
  for (const night of shown) {
    const chip = document.createElement("span");
    chip.className = "night-chip";
    if (night === highlightDate) chip.classList.add("highlight");
    chip.textContent = formatNight(night);
    block.append(chip);
  }
  if (nights.length > shown.length) {
    const more = document.createElement("span");
    more.className = "night-more";
    more.textContent = `+${nights.length - shown.length} more`;
    block.append(more);
  }
  return block;
}

function linksBlock(facility: Facility): HTMLElement {
  const links = document.createElement("p");
  links.className = "links";

  const booking = document.createElement("a");
  booking.href = facility.booking_url;
  booking.target = "_blank";
  booking.rel = "noreferrer";
  booking.className = "primary-link";
  booking.textContent =
    facility.availability === "calendar"
      ? "Book this place"
      : facility.availability === "unknown"
        ? "Booking is run elsewhere — details"
        : "Details";

  const map = document.createElement("a");
  map.href = `https://www.openstreetmap.org/?mlat=${facility.lat}&mlon=${facility.lon}#map=16/${facility.lat}/${facility.lon}`;
  map.target = "_blank";
  map.rel = "noreferrer";
  map.textContent = "Open in OSM";

  links.append(booking, map);
  return links;
}
