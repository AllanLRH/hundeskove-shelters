/**
 * Assertions over the filter model, run against the real generated data.
 *
 * These cover the semantics that are easy to get quietly wrong: that a night is
 * named by its arrival weekday, that "no calendar" is not "never free", and that
 * the confidence tiers partition the dataset.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDataset, nightIndex } from "../src/data";
import {
  applyFilters,
  defaultFilters,
  fromHash,
  toHash,
  type Filters,
} from "../src/filters";
import type { Availability, Confidence, RawAvailability } from "../src/types";

// npm runs this with cwd = ui/, and the bundle lives elsewhere, so resolve
// from cwd rather than from the module location.
const OUT = resolve(process.cwd(), "../output");
const raw = JSON.parse(
  readFileSync(resolve(OUT, "availability.json"), "utf8"),
) as RawAvailability;
const data = buildDataset(raw, null);

let failures = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

// --- night semantics -------------------------------------------------------
check(
  "a Friday date is the fri–sat night (index 4)",
  nightIndex("2026-09-11") === 4,
  `got ${nightIndex("2026-09-11")}`,
);
check("Sunday maps to index 6", nightIndex("2026-09-13") === 6);

const weekendOnly = defaultFilters(data);
const weekendHits = applyFilters(data, weekendOnly);
const strayNight = weekendHits
  .flatMap((hit) => hit.nights)
  .find((date) => nightIndex(date) !== 4 && nightIndex(date) !== 5);
check("default filters return only fri–sat / sat–sun nights", !strayNight, strayNight);
check(
  "weekend is the default selection",
  weekendOnly.nights.size === 2 && weekendOnly.nights.has(4) && weekendOnly.nights.has(5),
);
check(
  "marker_only is off by default",
  !defaultFilters(data).confidence.has("marker_only"),
);

check(
  "'near the boundary' is off by default",
  !defaultFilters(data).confidence.has("near"),
);
check(
  "only Shelter is selected by default",
  [...defaultFilters(data).facilityTypes].join() === "Shelter",
  [...defaultFilters(data).facilityTypes].join(", "),
);

// --- tri-state availability ------------------------------------------------
function allOf(states: Availability[]): Filters {
  const filters = defaultFilters(data);
  filters.availability = new Set(states);
  filters.confidence = new Set([
    "inside",
    "inside_osm",
    "overlapping",
    "near",
    "marker_only",
  ] as Confidence[]);
  filters.nights = new Set([0, 1, 2, 3, 4, 5, 6]);
  filters.facilityTypes = new Set(data.facilities.map((f) => f.facility_type));
  return filters;
}

function countWith(states: Availability[]): number {
  return applyFilters(data, allOf(states)).length;
}
const calendarOnly = countWith(["calendar"]);
const plusOpen = countWith(["calendar", "open"]);
const all = countWith(["calendar", "open", "unknown"]);
check(`only bookable -> ${calendarOnly}`, calendarOnly === 58, String(calendarOnly));
check(`+ first-come -> ${plusOpen}`, plusOpen === 302, String(plusOpen));
check(`+ unknown -> ${all}`, all === data.facilities.length, String(all));

// --- confidence tiers ------------------------------------------------------
const tiers = new Map<Confidence, number>();
for (const facility of data.facilities) {
  tiers.set(facility.confidence, (tiers.get(facility.confidence) ?? 0) + 1);
}
const total = [...tiers.values()].reduce((a, b) => a + b, 0);
check("confidence tiers partition the dataset", total === data.facilities.length);
check(
  "27 facilities are strictly inside an official boundary",
  (tiers.get("inside") ?? 0) + (tiers.get("inside_osm") ?? 0) === 27,
  JSON.stringify(Object.fromEntries(tiers)),
);
check(
  "nothing is 'inside' a boundary-less forest",
  !data.facilities.some((f) => f.inside_polygon && !f.dog_forest_has_boundary),
);

// --- picking a single night ------------------------------------------------
// What the calendar's day detail and the map's selection both rely on.
const dayFilters = allOf(["calendar", "open", "unknown"]);
const someFriday = data.allDates.find((date) => nightIndex(date) === 4)!;
dayFilters.day = someFriday;
const dayHits = applyFilters(data, dayFilters);
check(
  `picking ${someFriday} yields only that night`,
  dayHits.every((hit) => hit.nights.length === 1 && hit.nights[0] === someFriday),
);
const dayBookable = dayHits.filter((hit) => hit.facility.availability === "calendar");
check(
  `that night has bookable places to show (${dayBookable.length})`,
  dayBookable.length > 0,
);
check(
  "every bookable place has a usable booking link",
  dayBookable.every((hit) =>
    hit.facility.booking_url.startsWith("https://book.naturstyrelsen.dk/sted/?id="),
  ),
);
check(
  "the day detail splits into bookable plus the rest, losing nothing",
  dayBookable.length +
    dayHits.filter((hit) => hit.facility.availability !== "calendar").length ===
    dayHits.length,
);

// --- URL round-trip --------------------------------------------------------
const tweaked = defaultFilters(data);
tweaked.maxDistance = 120;
tweaked.nights = new Set([0, 4]);
tweaked.day = data.allDates[3]!;
const restored = fromHash(`#${toHash(tweaked, data)}`, data);
// Regression: selecting every facility type must survive a reload. When the
// default was "all types", toHash omitted the parameter in exactly this case.
const allTypes = allOf(["calendar", "open", "unknown"]);
const restoredTypes = fromHash(`#${toHash(allTypes, data)}`, data);
check(
  "selecting every facility type survives a round-trip",
  restoredTypes.facilityTypes.size === allTypes.facilityTypes.size,
  `${restoredTypes.facilityTypes.size} of ${allTypes.facilityTypes.size}`,
);

check(
  "filters survive a URL round-trip",
  restored.maxDistance === 120 &&
    restored.day === tweaked.day &&
    [...restored.nights].sort().join() === "0,4",
);

console.log(failures === 0 ? "\nall UI checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
