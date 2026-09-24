"""Guards over the generated output, run by `just check`.

These are the invariants that have actually broken before: a CRS mix-up putting
coordinates outside Denmark, and availability being confused with bookability.
"""

import collections
import json
import sys
from pathlib import Path

from shapely.geometry import shape

OUT = Path("output")
# Generous bounding box around Denmark, incl. Bornholm.
LAT = (54.4, 57.9)
LON = (7.9, 15.4)


def fail(message: str) -> None:
    print(f"FAIL {message}")
    sys.exit(1)


def main() -> None:
    availability_path = OUT / "availability.json"
    geojson_path = OUT / "dog_forests.geojson"
    if not availability_path.exists():
        fail(f"{availability_path} missing — run `just data`")

    rows = json.loads(availability_path.read_text(encoding="utf-8"))["shelters"]
    outside = [
        r
        for r in rows
        if not (LAT[0] <= r["lat"] <= LAT[1] and LON[0] <= r["lon"] <= LON[1])
    ]
    if outside:
        fail(f"{len(outside)} facilities outside Denmark, e.g. {outside[0]['name']!r}")

    # Only facilities with a real calendar may carry dates.
    wrong = [
        r
        for r in rows
        if r["available_dates"] and r["booking_status"] != "naturstyrelsen"
    ]
    if wrong:
        fail(f"{len(wrong)} non-Naturstyrelsen facilities carry dates")

    # Nothing may be reported inside a dog forest that has no outline.
    impossible = [
        r for r in rows if r["inside_polygon"] and not r["dog_forest_has_boundary"]
    ]
    if impossible:
        fail(f"{len(impossible)} facilities marked inside a boundary-less forest")

    # Live-data assertions. These belong here rather than in the unit suite:
    # they check the dataset currently on disk, so they are expected to move
    # when it is refreshed. Mixed in with unit tests they failed on a data
    # refresh rather than on a regression.
    statuses = collections.Counter(r["booking_status"] for r in rows)
    with_calendar = statuses["naturstyrelsen"]
    first_come = statuses["not_bookable"]
    print(
        f"ok  {len(rows)} facilities: {with_calendar} bookable, "
        f"{first_come} free/first-come, {statuses['other_operator']} booked elsewhere"
    )

    # Only facilities with a real calendar may carry dates, and "no calendar"
    # must never be confused with "never free".
    if first_come == 0:
        fail("no free/first-come facilities at all — suspicious, check the pipeline")

    inside = sum(1 for r in rows if r["inside_polygon"])
    print(f"ok  {inside} facilities strictly inside a dog forest")
    if inside == 0:
        fail("nothing is inside a dog forest — the spatial join has broken")

    regions = {r["region"] for r in rows}
    if not regions <= {81, 82, 83, 84, 85}:
        fail(f"unexpected region ids: {sorted(regions - {81, 82, 83, 84, 85})}")

    print(f"ok  {len(rows)} facilities, coordinates and availability consistent")

    if not geojson_path.exists():
        fail(f"{geojson_path} missing — run `just discover`")
    forests = json.loads(geojson_path.read_text(encoding="utf-8"))
    if forests.get("type") != "FeatureCollection":
        fail("dog_forests.geojson is not a FeatureCollection")

    bad = []
    for feature in forests["features"]:
        min_lon, min_lat, max_lon, max_lat = shape(feature["geometry"]).bounds
        if not (
            LON[0] <= min_lon
            and max_lon <= LON[1]
            and LAT[0] <= min_lat
            and max_lat <= LAT[1]
        ):
            bad.append(feature["properties"]["name"])
    if bad:
        fail(f"{len(bad)} dog forests outside Denmark, e.g. {bad[0]!r}")
    print(f"ok  {len(forests['features'])} dog forest features, all within Denmark")


if __name__ == "__main__":
    main()
