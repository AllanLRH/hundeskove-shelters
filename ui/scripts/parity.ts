/**
 * The UI's logic, run against the dataset actually on disk.
 *
 * The unit suite uses a fixture so it stays deterministic; this is the
 * counterpart that checks the real output — the same role
 * `scripts/check_outputs.py` plays for the Python side. It exists because the
 * refactor made these numbers reachable without a browser: before, "does the
 * default view still show 11 of 338?" could only be answered by looking.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defaultFilters } from "../src/domain/filters";
import { findMatches, tallyNights } from "../src/domain/search";
import { confidenceOf } from "../src/domain/facility";
import { parseDataset, type WireAvailability } from "../src/io/wire";

const OUT = resolve(process.cwd(), "../output");
const raw = JSON.parse(
  readFileSync(resolve(OUT, "availability.json"), "utf8"),
) as WireAvailability;

const dataset = parseDataset(raw);
const filters = defaultFilters(dataset);
const matches = findMatches(dataset, filters);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok   ${label}`);
  else {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

const kinds = { bookable: 0, open: 0, unknown: 0 };
for (const facility of dataset.facilities) kinds[facility.availability.kind] += 1;
console.log(
  `     ${dataset.facilities.length} facilities: ${kinds.bookable} bookable, ` +
    `${kinds.open} free/first-come, ${kinds.unknown} booked elsewhere`,
);
console.log(`     default view shows ${matches.length}`);

check("the wire parse produced facilities", dataset.facilities.length > 0);
check(
  "every facility parsed into a known availability kind",
  kinds.bookable + kinds.open + kinds.unknown === dataset.facilities.length,
);
check(
  "only bookable facilities carry free nights",
  dataset.facilities.every(
    (f) => f.availability.kind === "bookable" || !("freeNights" in f.availability),
  ),
);
check(
  "the default view is non-empty but strict",
  matches.length > 0 && matches.length < dataset.facilities.length,
  `${matches.length} of ${dataset.facilities.length}`,
);
check(
  "the defaults surface only facilities in a dog forest",
  matches.every((m) => ["inside", "inside_osm", "overlapping"].includes(
    confidenceOf(m.facility.proximity),
  )),
);
check(
  "nothing is reported inside a forest that has no outline",
  dataset.facilities.every(
    (f) => !(f.proximity.insidePolygon && !f.proximity.forest.hasBoundary),
  ),
);
check(
  "every night of the horizon has a tally",
  tallyNights(dataset, filters).size === dataset.nights.length,
);
check(
  "every facility has coordinates inside Denmark",
  dataset.facilities.every(
    (f) =>
      f.position.lat >= 54.4 && f.position.lat <= 57.9 &&
      f.position.lon >= 7.9 && f.position.lon <= 15.4,
  ),
);

console.log(failures === 0 ? "\nUI parity checks passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
