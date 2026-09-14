import { formatDuration } from "../travel";
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
  /** Driving seconds from the user's address, when one has been entered. */
  driveSeconds?: number | null;
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
  const {
    selected = false,
    onSelect,
    maxDates = 8,
    highlightDate = null,
    driveSeconds = null,
  } = options;

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

  if (driveSeconds !== null) {
    const drive = document.createElement("span");
    drive.className = "badge drive";
    drive.textContent = `${formatDuration(driveSeconds)} by car`;
    drive.title = "Driving time from your address, via OSRM";
    badges.append(drive);
  }

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
      // t=coordinates asks Krak to search for and pin this exact coordinate;
      // l=hybrid is its aerial-photo-plus-labels view ("Luftfoto" hybrid).
      // krak.dk sits behind a Cloudflare bot challenge, so this could not be
      // curl-verified like the others — it mirrors a URL confirmed working in
      // a real browser (?t=coordinates&c=lat,lon&l=hybrid&z=…&fit=true), minus
      // the trailing som= token, which looks like a session/analytics id
      // rather than anything location-related.
      label: "Krak",
      href: `https://www.krak.dk/kort/s%C3%B8g/${lat}%2C+${lon}?t=coordinates&c=${lat},${lon}&l=hybrid&z=${AERIAL_ZOOM}&fit=true`,
    },
    {
      // No aerial imagery, but it is the source of this data; mlat/mlon pins it.
      label: "OSM",
      href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
    },
  ];
}

/**
 * udinaturen.dk's own interactive map, with the Hundeskov layer and this
 * facility's own category layer both switched on — the same view the site's
 * "Vis på kort" quickstart produces.
 *
 * Reverse-engineered from its homepage form, whose onsubmit handler is
 * `location.href='/kort/?region='+region+activity` (`activity` already reads
 * `&categories=…`). The /kort page runs an inline script on load that clicks
 * the matching checkboxes — `$Id('region-84').click()`, then
 * `$Id('f_1133').click()`, `$Id('f_1115').click()`, … — confirmed by diffing
 * the rendered page with and without these query params.
 *
 * **This map cannot be centred on a point.** Its OpenLayers view is only ever
 * driven by `zoomToRegins()`, which fits to the checked regions' ZoomPoints.
 * OpenLayers' own `Link` control (which would sync `x`/`y`/`z` to the URL) is
 * present in the bundle but never instantiated: loading `/kort/` with
 * `x`/`y`/`z` set leaves `map.getView().getCenter()` untouched, and panning
 * never writes those params back. `center`, `zoom`, `lat`/`lon` and
 * `kommunekoder` do nothing either, and the page has no kommune-level filter
 * to narrow to.
 *
 * So the tightest this can be aimed is the facility's *own* region rather than
 * all five — measured in the live page, that is zoom 9.58 instead of 8.37.
 * For an actually-local view, see `udinaturenFacilityUrl`.
 */
export function udinaturenMapUrl(facility: Facility): string {
  return `https://udinaturen.dk/kort/?region=${facility.region}&categories=1133,${facility.umb_id}`;
}

/**
 * udinaturen's page for this exact facility, whose embedded map *is* centred
 * on it at roughly a 20 m scale.
 *
 * The slug segment is decorative — `/facilitet/?id=<guid>` serves the correct
 * page on its own (verified against the live site), so this needs nothing but
 * the GUID we already carry. The trade-off against `udinaturenMapUrl` is that
 * this map shows only the facility and its immediate neighbours, with no
 * Hundeskov layer — the two capabilities live on different pages and neither
 * page offers both.
 */
export function udinaturenFacilityUrl(facility: Facility): string {
  return `https://udinaturen.dk/facilitet/?id=${facility.shelter_id}`;
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
    if (label === "OSM") {
      link.title = "OpenStreetMap — map data, no imagery";
      // A class, not the presence of a title attribute: the udinaturen link
      // below also has one (for its own, different reason), and matching on
      // any titled link in a .map-links row previously meant either one could
      // silently pick up styling meant for the other.
      link.classList.add("map-link-muted");
    }
    aerial.append(link);
  }

  // A separate row from "Aerial view:", because neither of these pins the
  // facility the way those five do. udinaturen splits the two things you want
  // across two pages: one can show the Hundeskov layer but only aims at a
  // whole region, the other is centred on the facility but has no such layer.
  // Offering both, labelled for what each actually does, beats silently
  // picking one and leaving the other unreachable.
  const source = document.createElement("p");
  source.className = "map-links";
  const sourceCaption = document.createElement("span");
  sourceCaption.className = "map-links-label";
  sourceCaption.textContent = "On udinaturen:";

  const layersLink = document.createElement("a");
  layersLink.href = udinaturenMapUrl(facility);
  layersLink.target = "_blank";
  layersLink.rel = "noreferrer";
  layersLink.textContent = `Hundeskov + ${facility.facility_type} layers`;
  layersLink.title =
    "udinaturen's map with both layers on. It cannot be centred on a point, " +
    "so it opens fitted to this facility's region.";

  const spotLink = document.createElement("a");
  spotLink.href = udinaturenFacilityUrl(facility);
  spotLink.target = "_blank";
  spotLink.rel = "noreferrer";
  spotLink.textContent = "this spot";
  spotLink.title =
    "udinaturen's page for this facility — its map is zoomed right in, " +
    "but shows no Hundeskov layer.";

  source.append(sourceCaption, layersLink, spotLink);

  wrapper.append(primary, aerial, source);
  return wrapper;
}
