"""Guards over the generated output, run by `just check`.

These are the invariants that have actually broken before: a CRS mix-up putting
coordinates outside Denmark, and availability being confused with bookability.
"""

import json
import sys
from pathlib import Path

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
    impossible = [r for r in rows if r["inside_polygon"] and not r["dog_forest_has_boundary"]]
    if impossible:
        fail(f"{len(impossible)} facilities marked inside a boundary-less forest")

    print(f"ok  {len(rows)} facilities, coordinates and availability consistent")

    if not geojson_path.exists():
        fail(f"{geojson_path} missing — run `just discover`")
    forests = json.loads(geojson_path.read_text(encoding="utf-8"))
    if forests.get("type") != "FeatureCollection":
        fail("dog_forests.geojson is not a FeatureCollection")

    bad = []
    for feature in forests["features"]:
        for lon, lat in _coords(feature["geometry"]):
            if not (LAT[0] <= lat <= LAT[1] and LON[0] <= lon <= LON[1]):
                bad.append(feature["properties"]["name"])
                break
    if bad:
        fail(f"{len(bad)} dog forests outside Denmark, e.g. {bad[0]!r}")
    print(f"ok  {len(forests['features'])} dog forest features, all within Denmark")


def _coords(geometry: dict):
    """Yield (lon, lat) pairs from any GeoJSON geometry."""
    if geometry["type"] == "GeometryCollection":
        stack = [g["coordinates"] for g in geometry["geometries"]]
    else:
        stack = [geometry["coordinates"]]
    while stack:
        item = stack.pop()
        if (
            isinstance(item, (list, tuple))
            and len(item) == 2
            and all(isinstance(v, (int, float)) for v in item)
        ):
            yield item
        elif isinstance(item, (list, tuple)):
            stack.extend(item)


if __name__ == "__main__":
    main()
