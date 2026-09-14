/**
 * One facility, rendered the same wherever it appears.
 *
 * The list, the calendar's night detail and the map's selection all use this,
 * so "which places, and where do I book them" cannot read differently
 * depending on which tab you are on.
 */

import {
  AVAILABILITY_LABEL,
  CONFIDENCE_LABEL,
  confidenceOf,
  describeProximity,
  type Facility,
} from "../domain/facility";
import { aerialLinks, udinaturenFacilityUrl, udinaturenMapUrl } from "../domain/links";
import type { Night } from "../domain/night";
import { formatDuration } from "../domain/travel";

export interface CardOptions {
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Nights beyond this are summarised rather than listed. Infinity lists all. */
  maxNights?: number;
  /** Rendered with emphasis, e.g. the night picked in the calendar. */
  highlightNight?: Night | null;
  /** Driving seconds from the user's address, when one has been entered. */
  driveSeconds?: number | null;
}

const NIGHT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatNight(night: Night): string {
  return NIGHT_FORMAT.format(new Date(`${night}T12:00:00Z`));
}

export function facilityCard(
  facility: Facility,
  nights: readonly Night[],
  options: CardOptions = {},
): HTMLElement {
  const {
    selected = false,
    onSelect,
    maxNights = 8,
    highlightNight = null,
    driveSeconds = null,
  } = options;

  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = facility.id;
  if (selected) card.classList.add("selected");
  if (onSelect) card.tabIndex = 0;

  const title = document.createElement("h3");
  title.textContent = facility.name || "(unnamed)";
  const type = document.createElement("span");
  type.className = "type";
  type.textContent = facility.type;
  title.append(type);

  const forest = document.createElement("p");
  forest.className = "forest";
  const proximity = describeProximity(facility.proximity);
  forest.textContent = facility.proximity.forest.name
    ? `${proximity} — ${facility.proximity.forest.name}`
    : proximity;

  card.append(title, forest, badges(facility, nights, driveSeconds));

  if (facility.description) {
    const description = document.createElement("p");
    description.className = "description";
    description.textContent = facility.description;
    card.append(description);
  }

  card.append(nightsBlock(facility, nights, maxNights, highlightNight));
  card.append(linksBlock(facility));

  if (onSelect) {
    card.addEventListener("click", (event) => {
      // Let a link do its own thing rather than selecting the card.
      if ((event.target as HTMLElement).closest("a")) return;
      onSelect(facility.id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(facility.id);
      }
    });
  }
  return card;
}

function badges(
  facility: Facility,
  nights: readonly Night[],
  driveSeconds: number | null,
): HTMLElement {
  const row = document.createElement("p");
  row.className = "badges";

  const confidence = confidenceOf(facility.proximity);
  const confidenceBadge = document.createElement("span");
  confidenceBadge.className = `badge conf-${confidence}`;
  confidenceBadge.textContent = CONFIDENCE_LABEL[confidence];

  const availability = document.createElement("span");
  availability.className = `badge avail-${facility.availability.kind}`;
  availability.textContent = AVAILABILITY_LABEL[facility.availability.kind];
  row.append(confidenceBadge, availability);

  if (driveSeconds !== null) {
    const drive = document.createElement("span");
    drive.className = "badge drive";
    drive.textContent = `${formatDuration(driveSeconds)} by car`;
    drive.title = "Driving time from your address, via OSRM";
    row.append(drive);
  }

  if (facility.availability.kind === "bookable") {
    const count = document.createElement("span");
    count.className = "badge nights";
    count.textContent = `${nights.length} night${nights.length === 1 ? "" : "s"} free`;
    row.append(count);
  }
  return row;
}

function nightsBlock(
  facility: Facility,
  nights: readonly Night[],
  maxNights: number,
  highlightNight: Night | null,
): HTMLElement {
  const block = document.createElement("p");
  block.className = "dates";

  if (facility.availability.kind === "open") {
    block.classList.add("note");
    block.textContent = "No booking needed — turn up any night.";
    return block;
  }
  if (facility.availability.kind === "unknown") {
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

  for (const night of nights.slice(0, maxNights)) {
    const chip = document.createElement("span");
    chip.className = "night-chip";
    if (night === highlightNight) chip.classList.add("highlight");
    chip.textContent = formatNight(night);
    block.append(chip);
  }
  if (nights.length > maxNights) {
    const more = document.createElement("span");
    more.className = "night-more";
    more.textContent = `+${nights.length - maxNights} more`;
    block.append(more);
  }
  return block;
}

function linksBlock(facility: Facility): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "card-links";

  const primary = document.createElement("p");
  primary.className = "links";
  const booking = document.createElement("a");
  booking.href = facility.booking.url;
  booking.target = "_blank";
  booking.rel = "noreferrer";
  booking.className = "primary-link";
  booking.textContent =
    facility.availability.kind === "bookable"
      ? "Book this place"
      : facility.availability.kind === "unknown"
        ? "Booking is run elsewhere — details"
        : "Details";
  primary.append(booking);

  const aerial = document.createElement("p");
  aerial.className = "map-links";
  const caption = document.createElement("span");
  caption.className = "map-links-label";
  caption.textContent = "Aerial view:";
  aerial.append(caption);
  for (const link of aerialLinks(facility)) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = link.label;
    if (link.title) anchor.title = link.title;
    if (link.muted) anchor.classList.add("map-link-muted");
    aerial.append(anchor);
  }

  // A row of its own, because neither of these pins the facility the way the
  // aerial links do: udinaturen splits "show the dog-forest layer" and "centre
  // on this place" across two pages, and neither page does both.
  const source = document.createElement("p");
  source.className = "map-links";
  const sourceCaption = document.createElement("span");
  sourceCaption.className = "map-links-label";
  sourceCaption.textContent = "On udinaturen:";

  const layers = document.createElement("a");
  layers.href = udinaturenMapUrl(facility);
  layers.target = "_blank";
  layers.rel = "noreferrer";
  layers.textContent = `Hundeskov + ${facility.type} layers`;
  layers.title =
    "udinaturen's map with both layers on. It cannot be centred on a point, " +
    "so it opens fitted to this facility's region.";

  const spot = document.createElement("a");
  spot.href = udinaturenFacilityUrl(facility);
  spot.target = "_blank";
  spot.rel = "noreferrer";
  spot.textContent = "this spot";
  spot.title =
    "udinaturen's page for this facility — its map is zoomed right in, " +
    "but shows no Hundeskov layer.";

  source.append(sourceCaption, layers, spot);
  wrapper.append(primary, aerial, source);
  return wrapper;
}
