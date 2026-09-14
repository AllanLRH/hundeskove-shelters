/**
 * Assertions over the filter model, run against the real generated data.
 *
 * These cover the semantics that are easy to get quietly wrong: that a night is
 * named by its arrival weekday, that "no calendar" is not "never free", and that
 * the confidence tiers partition the dataset.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDataset, isoWeek, nightIndex } from "../src/data";
import {
  applyCalendarFilters,
  applyFilters,
  defaultFilters,
  fromHash,
  toHash,
  type Filters,
} from "../src/filters";
import type { Availability, Confidence, RawAvailability } from "../src/types";
import { STORAGE_KEY } from "../src/theme";
import { formatDuration } from "../src/travel";
import {
  mapServices,
  udinaturenFacilityUrl,
  udinaturenMapUrl,
} from "../src/views/card";

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

// --- ISO week numbers -------------------------------------------------------
// Known-tricky cases: the year boundary can fall either way depending on
// which weekday 1 January lands on.
check("2026-01-01 (a Thursday) is week 1", isoWeek("2026-01-01") === 1);
check(
  "2026-12-28 (the last Monday of 2026) is week 53",
  isoWeek("2026-12-28") === 53,
  String(isoWeek("2026-12-28")),
);
check(
  "2027-01-01 (a Friday) belongs to 2026's week 53, not week 1",
  isoWeek("2027-01-01") === 53,
  String(isoWeek("2027-01-01")),
);
check(
  "every day in a Mon-Sun week shares one week number",
  new Set(
    ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"].map(
      isoWeek,
    ),
  ).size === 1,
);

// --- the calendar ignores Nights and Dates, but not the other filters -----
{
  const scoped = defaultFilters(data); // weekend-only nights, full date range
  const listHits = applyFilters(data, scoped);
  const calHits = applyCalendarFilters(data, scoped);

  check(
    "the list stays weekend-only under the default filters",
    listHits.every((hit) => hit.nights.every((date) => nightIndex(date) === 4 || nightIndex(date) === 5)),
  );
  check(
    "the calendar includes non-weekend nights the list does not",
    calHits.some((hit) => hit.nights.some((date) => nightIndex(date) !== 4 && nightIndex(date) !== 5)),
  );

  const narrowed = defaultFilters(data);
  narrowed.nights = new Set([0, 1, 2, 3, 4, 5, 6]);
  narrowed.from = data.horizonStart;
  narrowed.to = data.allDates[6]!; // first week of the horizon only
  const narrowList = applyFilters(data, narrowed);
  const narrowCal = applyCalendarFilters(data, narrowed);
  check(
    "a tightened date range still narrows the list",
    narrowList.every((hit) => hit.nights.every((date) => date <= narrowed.to)),
  );
  check(
    "but not the calendar",
    narrowCal.some((hit) => hit.nights.some((date) => date > narrowed.to)),
  );

  check(
    "the calendar still respects non-time filters (facility type, confidence, ...)",
    calHits.every((hit) => scoped.facilityTypes.has(hit.facility.facility_type)),
  );
}

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

// --- external map links ----------------------------------------------------
// These are user-facing and cannot be eyeballed from here, so assert the URL
// contract: right coordinates, and each service asked for aerial imagery.
const sample = data.facilities.find((f) => f.availability === "calendar")!;
const services = mapServices(sample);
check(
  "every map service gets the facility's coordinates",
  services.every(
    (s) => s.href.includes(String(sample.lat)) && s.href.includes(String(sample.lon)),
  ),
);
const aerialParam: Record<string, string> = {
  // Google's satellite basemap is the data=!3m1!1e3 segment in the /place/ form.
  Google: "data=!3m1!1e3",
  Apple: "t=k",
  Bing: "style=h",
  Krak: "l=hybrid",
};
check(
  "Google, Apple, Bing and Krak are asked for satellite/aerial",
  services
    .filter((s) => s.label in aerialParam)
    .every((s) => s.href.includes(aerialParam[s.label]!)),
  services.map((s) => s.label).join(", "),
);

// Krak could not be curl-verified (Cloudflare bot challenge on krak.dk), so
// its URL is copied from a real working example rather than reverse-engineered
// from documentation. Assert the shape matches what was actually observed,
// and that the session/analytics token from that example (som=...) did not
// leak into a coordinate-based link that has nothing to do with that session.
const krak = services.find((s) => s.label === "Krak")!.href;
check(
  "Krak's URL matches the confirmed-working shape",
  krak.startsWith("https://www.krak.dk/kort/s%C3%B8g/") && krak.includes("&z=") && !krak.includes("&som="),
  krak,
);

// The regression that prompted this: centring the viewport is not a waypoint.
const pinMarker: Record<string, string> = {
  Google: "/maps/place/",
  Apple: "q=",
  Bing: "sp=point.",
  Krak: "t=coordinates",
  OSM: "mlat=",
};
check(
  "every service drops a pin, not just a centred viewport",
  services.every((s) => s.href.includes(pinMarker[s.label]!)),
  services.filter((s) => !s.href.includes(pinMarker[s.label]!)).map((s) => s.label).join(", "),
);
check(
  "no service is merely centred (map_action=map / bare cp=)",
  services.every((s) => !s.href.includes("map_action=map") && !s.href.includes("?cp=")),
);
// A name with an underscore would truncate Bing's pin, and encodeURIComponent
// does not escape underscores.
const awkward = { ...sample, name: "Shelter_A_B", lat: 56, lon: 10 };
const bing = mapServices(awkward).find((s) => s.label === "Bing")!.href;
check(
  "an underscore in a name cannot break Bing's pin",
  bing.includes("sp=point.56_10_") && !bing.slice(bing.indexOf("_10_") + 4).includes("_"),
  bing,
);
const blank = mapServices({ ...sample, name: "   " }).find((s) => s.label === "Apple")!.href;
check("a blank name still pins with a fallback label", blank.includes("q=Shelter&"));

check(
  "every map link is https",
  services.every((s) => s.href.startsWith("https://")),
);

// --- udinaturen's own map: no coordinates, but the right layers on ---------
// Reverse-engineered by diffing the live /kort page's response with and
// without query params (see card.ts) — the shape asserted here is what that
// diff showed, not a guess.
const udinaturenUrl = udinaturenMapUrl(sample);
check(
  "udinaturen's map link aims at the facility's own region, not all of Denmark",
  udinaturenUrl.includes(`region=${sample.region}`) &&
    !udinaturenUrl.includes("region=81,82,83,84,85"),
  udinaturenUrl,
);
check(
  "every facility carries a region in 81-85 to aim it with",
  data.facilities.every((f) => Number.isInteger(f.region) && f.region >= 81 && f.region <= 85),
);
check(
  "udinaturen's link turns on Hundeskov plus this facility's own category",
  udinaturenUrl.includes(`categories=1133,${sample.umb_id}`),
  udinaturenUrl,
);
check(
  "the category matches whichever facility is asked for, across all four types",
  [1115, 1111, 1112, 1106].every((umb_id) =>
    udinaturenMapUrl({ ...sample, umb_id }).includes(`categories=1133,${umb_id}`),
  ),
);
check(
  "udinaturen's link is https and points at udinaturen.dk",
  udinaturenUrl.startsWith("https://udinaturen.dk/"),
);

// The zoomed-in counterpart: udinaturen's map cannot be centred on a point,
// so the facility's own page carries that half of the job. The slug segment
// is decorative -- /facilitet/?id=<guid> serves the right page by itself.
const facilityUrl = udinaturenFacilityUrl(sample);
check(
  "the facility-page link is built from the GUID alone, with no slug to get wrong",
  facilityUrl === `https://udinaturen.dk/facilitet/?id=${sample.shelter_id}`,
  facilityUrl,
);

// --- driving times ---------------------------------------------------------
{
  check("formatDuration: under an hour", formatDuration(38 * 60) === "38 min", formatDuration(38 * 60));
  check("formatDuration: exact hours drop the minutes", formatDuration(7200) === "2 h", formatDuration(7200));
  check("formatDuration: hours and minutes", formatDuration(4320) === "1 h 12 min", formatDuration(4320));

  const withDrive = allOf(["calendar", "open", "unknown"]);
  const ids = data.facilities.map((f) => f.shelter_id);
  // Two within an hour, one well beyond it.
  const durations = new Map<string, number>([
    [ids[0]!, 20 * 60],
    [ids[1]!, 45 * 60],
    [ids[2]!, 200 * 60],
  ]);

  withDrive.maxDriveMinutes = 60;
  const within = applyFilters(data, withDrive, durations);
  check(
    "a drive-time limit keeps only facilities inside it",
    within.length === 2 && within.every((h) => durations.get(h.facility.shelter_id)! <= 3600),
    String(within.length),
  );
  check(
    "facilities OSRM could not route to are excluded once a limit is set",
    !within.some((h) => !durations.has(h.facility.shelter_id)),
  );

  // The guard that matters while a request is still in flight: an empty map
  // must not mean "nothing is within range".
  const noData = applyFilters(data, withDrive, new Map());
  check(
    "an empty duration map skips the filter instead of hiding everything",
    noData.length > within.length,
    `${noData.length} vs ${within.length}`,
  );

  const sorted = { ...withDrive, maxDriveMinutes: null, sortBy: "drive" as const };
  const nearestFirst = applyFilters(data, sorted, durations);
  check(
    "sorting nearest-first puts the 20-minute one ahead of the 45-minute one",
    nearestFirst[0]!.facility.shelter_id === ids[0] &&
      nearestFirst[1]!.facility.shelter_id === ids[1],
  );
  check(
    "facilities with no routing result sort last, not first",
    durations.has(nearestFirst[0]!.facility.shelter_id),
  );

  // The address must never reach the shareable link.
  const hashed = toHash({ ...withDrive, maxDriveMinutes: 90, sortBy: "drive" }, data);
  check("the drive-time limit is shareable", hashed.includes("drive=90"));
  check("the sort order is shareable", hashed.includes("sort=drive"));
  check(
    "no address or coordinate leaks into the URL hash",
    !/address|lat|lon|origin/i.test(hashed),
    hashed,
  );
}

// --- theme -----------------------------------------------------------------
// The pre-paint script in index.html duplicates the storage key by necessity
// (it must run before any module loads). Assert the two cannot drift apart.
const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
check(
  "the pre-paint theme script uses the same storage key as theme.ts",
  html.includes(`localStorage.getItem("${STORAGE_KEY}")`),
  STORAGE_KEY,
);
check(
  "the pre-paint script is a classic script, so Vite cannot defer it",
  /<script>\s*\/\*[\s\S]*?localStorage/.test(html),
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
