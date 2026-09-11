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

const AERIAL_ZOOM = 18;

/**
 * Where to look at the terrain around a facility.
 *
 * Aerial imagery, because the question these answer is "what is actually there"
 * — tree cover, a clearing, how far the water is — which a road map cannot show.
 *
 * Every one of these drops a **pin** at the coordinates, the way pasting
 * coordinates into the service's own search box would. Merely centring the
 * viewport (Google's `map_action=map`, Apple's bare `ll`, Bing's `cp`) leaves
 * you guessing which clearing in the trees is the shelter.
 */
export function mapServices(facility: Facility): { label: string; href: string }[] {
  const { lat, lon } = facility;
  // 6 facilities have a blank name upstream, so fall back rather than pinning
  // an empty label.
  const label = facility.name.trim() || "Shelter";
  // encodeURIComponent leaves "_" alone, and Bing splits sp=point. on
  // underscores — a name containing one would silently truncate the pin.
  const pinLabel = encodeURIComponent(label).replaceAll("_", "%5F");
  return [
    {
      label: "Google",
      // The form Google itself produces for a searched coordinate switched to
      // satellite: /place/ gives the pin, data=!3m1!1e3 the imagery. The
      // documented ?api=1 form can do one or the other, never both.
      href: `https://www.google.com/maps/place/${lat},${lon}/@${lat},${lon},${AERIAL_ZOOM}z/data=!3m1!1e3`,
    },
    {
      // MapKit URL scheme: q alongside ll labels a pin at ll rather than
      // running a search; t=k is satellite.
      label: "Apple",
      href: `https://maps.apple.com/?q=${encodeURIComponent(label)}&ll=${lat},${lon}&z=${AERIAL_ZOOM}&t=k`,
    },
    {
      // sp=point.lat_lon_title drops a labelled pushpin; style=h is aerial with
      // labels. Underscores separate the fields, so the title must be encoded.
      label: "Bing",
      href: `https://www.bing.com/maps?sp=point.${lat}_${lon}_${pinLabel}&lvl=${AERIAL_ZOOM}&style=h`,
    },
    {
      // No aerial imagery, but it is the source of this data; mlat/mlon pins it.
      label: "OSM",
      href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
    },
  ];
}

function linksBlock(facility: Facility): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "card-links";

  const primary = document.createElement("p");
  primary.className = "links";
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
  primary.append(booking);

  const aerial = document.createElement("p");
  aerial.className = "map-links";
  const caption = document.createElement("span");
  caption.className = "map-links-label";
  caption.textContent = "Aerial view:";
  aerial.append(caption);
  for (const { label, href } of mapServices(facility)) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = label;
    if (label === "OSM") link.title = "OpenStreetMap — map data, no imagery";
    aerial.append(link);
  }

  wrapper.append(primary, aerial);
  return wrapper;
}
