"""Command line entry point.

Two stages, deliberately separate:

* ``discover`` does the expensive work — fetching both facility layers, the
  spatial join, and scraping booking place ids. Its inputs barely change.
* ``availability`` reads that catalogue and only hits the calendar endpoint, so
  refreshing availability never re-runs the geometry or the place id lookups.
"""

import argparse
import csv
import json
import logging
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from pathlib import Path

import httpx2
from shapely.geometry import mapping

from . import booking, geo, osm, serve as serve_module, udinaturen

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36 hundeskove/0.1"
)

DEFAULT_CATALOGUE = Path("output/shelters.json")
DEFAULT_OUT_DIR = Path("output")
DEFAULT_CACHE = Path("cache/place_ids.json")
DEFAULT_OSM_CACHE = Path("cache/osm_dog_parks.json")
DEFAULT_GEOJSON = Path("output/dog_forests.geojson")
DEFAULT_UI_DIR = Path("ui/dist")

CSV_COLUMNS = [
    "shelter_name",
    "shelter_id",
    "facility_type",
    "umb_id",
    "dog_forest_name",
    "distance_m",
    "inside_polygon",
    "overlap_fraction",
    "dog_forest_has_boundary",
    "geofence_source",
    "commune_code",
    "org",
    "bookable",
    "booking_status",
    "place_id",
    "booking_url",
    "lat",
    "lon",
    "n_available",
    "available_dates",
]

logger = logging.getLogger("hundeskove")


def make_client() -> httpx2.Client:
    return httpx2.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=30.0,
        follow_redirects=True,
    )


# --------------------------------------------------------------------------- #
# Stage 1: discover
# --------------------------------------------------------------------------- #


def discover(
    regions: tuple[int, ...],
    categories: dict[int, str],
    max_distance_m: float,
    out_path: Path,
    cache_path: Path,
    use_cache: bool,
    max_workers: int,
    osm_cache_path: Path,
    refresh_osm: bool,
) -> dict:
    with make_client() as client:
        dog_forests = udinaturen.fetch_all_regions(
            client, udinaturen.DOG_FOREST_UMB_ID, regions
        )
        facilities = udinaturen.fetch_categories(client, categories, regions)
        logger.info("%d dog forests, %d facilities", len(dog_forests), len(facilities))

        parks = osm.to_polygons(osm.fetch_dog_parks(osm_cache_path, refresh_osm))
        dog_forests, filled = osm.fill_missing_geofences(dog_forests, parks)

        matches = geo.match_facilities(facilities, dog_forests, max_distance_m)
        matches.sort(key=lambda m: (not m.inside_polygon, m.distance_m))

        bookable_guids = [m.facility["id"] for m in matches if m.facility["booking"]]
        cache = booking.PlaceIdCache(cache_path, enabled=use_cache)
        place_ids = booking.resolve_place_ids(client, bookable_guids, cache, max_workers)

    records = []
    for match in matches:
        facility = match.facility
        easting, northing = geo.representative_coords(facility)
        lat, lon = geo.utm32_to_wgs84(easting, northing)
        place_id, booking_status = place_ids.get(
            facility["id"], (None, booking.STATUS_NOT_BOOKABLE)
        )
        records.append(
            {
                "shelter_id": facility["id"],
                "name": facility["name"],
                "facility_type": facility["facility_type"],
                "umb_id": facility["umb_id"],
                "description": facility["description"],
                "dog_forest_name": match.dog_forest["name"],
                "dog_forest_id": match.dog_forest["id"],
                "distance_m": round(match.distance_m, 1),
                "inside_polygon": match.inside_polygon,
                "overlap_fraction": (
                    None
                    if match.overlap_fraction is None
                    else round(match.overlap_fraction, 4)
                ),
                "dog_forest_has_boundary": geo.has_boundary(match.dog_forest),
                "geofence_source": match.dog_forest.get("geofence_source", "fkg"),
                "commune_code": facility["communeCode"],
                "org": facility["ansvar_Org"],
                "bookable": bool(facility["booking"]),
                "place_id": place_id,
                "booking_status": booking_status,
                "booking_url": booking.place_url(facility["id"]),
                "easting": round(easting, 1),
                "northing": round(northing, 1),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
            }
        )

    catalogue = {
        "generated_at": datetime.now(UTC).isoformat(),
        "attribution": {
            "facilities": "udinaturen.dk / GeoFA-FKG",
            "geofence_gaps": osm.ATTRIBUTION,
        },
        "parameters": {
            "regions": list(regions),
            "categories": categories,
            "max_distance_m": max_distance_m,
            "geofences_filled_from_osm": filled,
        },
        "shelters": records,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(catalogue, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    write_dog_forest_geojson(
        dog_forests, {r["dog_forest_id"] for r in records}, out_path.parent
    )

    statuses = Counter(r["booking_status"] for r in records)
    logger.info(
        "wrote %s: %d facilities, %d inside a dog forest; booking status %s",
        out_path,
        len(records),
        sum(r["inside_polygon"] for r in records),
        dict(statuses),
    )
    if statuses[booking.STATUS_OTHER_OPERATOR]:
        logger.info(
            "%d facilities are bookable but not through Naturstyrelsen "
            "(municipal or privately run) - see booking_url for each",
            statuses[booking.STATUS_OTHER_OPERATOR],
        )
    return catalogue


def write_dog_forest_geojson(
    dog_forests: list[dict], matched_ids: set[str], out_dir: Path
) -> Path:
    """Export dog-forest outlines in WGS84 so the map can draw the off-leash zones.

    Every forest is written, not only the matched ones: the unmatched outlines are
    what let you see that a facility sits just outside a boundary rather than in
    open country. `has_boundary` is false for forests that are only a marker.
    """
    features = []
    for forest in dog_forests:
        geometry = geo.utm32_to_wgs84_shape(geo.clean_geometry(forest))
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": forest["id"],
                    "name": forest["name"],
                    "geofence_source": forest.get("geofence_source", "fkg"),
                    "has_boundary": geo.has_boundary(forest),
                    "matched": forest["id"] in matched_ids,
                },
                "geometry": mapping(geometry),
            }
        )

    path = out_dir / DEFAULT_GEOJSON.name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info(
        "wrote %s: %d dog forests (%d matched, %d without an outline)",
        path,
        len(features),
        sum(f["properties"]["matched"] for f in features),
        sum(not f["properties"]["has_boundary"] for f in features),
    )
    return path

# --------------------------------------------------------------------------- #
# Stage 2: availability
# --------------------------------------------------------------------------- #


def check_availability(
    catalogue_path: Path,
    months: int,
    out_dir: Path,
    max_workers: int,
    anchor_step: int,
) -> None:
    if not catalogue_path.exists():
        raise SystemExit(
            f"No facility catalogue at {catalogue_path}. "
            "Run `hundeskove discover` first."
        )

    catalogue = json.loads(catalogue_path.read_text(encoding="utf-8"))
    records = catalogue["shelters"]

    start = date.today()
    end = booking.horizon_end(start, months)
    logger.info("checking availability for %s .. %s", start, end)

    with_place_id = [r for r in records if r["place_id"] is not None]

    def fetch(record: dict) -> set[date]:
        try:
            return booking.fetch_booked_dates(
                client, record["place_id"], start, end, anchor_step
            )
        except httpx2.HTTPError as exc:
            logger.warning(
                "calendar failed for %s (place %s): %s",
                record["name"],
                record["place_id"],
                exc,
            )
            return set()

    with make_client() as client:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            booked_per_facility = list(pool.map(fetch, with_place_id))

    booked_by_id = {
        record["shelter_id"]: booked
        for record, booked in zip(with_place_id, booked_per_facility)
    }

    checked_at = datetime.now(UTC).isoformat()
    results = []
    for record in records:
        booked = booked_by_id.get(record["shelter_id"])
        dates = booking.available_dates(booked, start, end) if booked is not None else []
        results.append(
            {
                **record,
                "horizon_start": start.isoformat(),
                "horizon_end": end.isoformat(),
                "checked_at": checked_at,
                "n_available": len(dates),
                "available_dates": [d.isoformat() for d in dates],
            }
        )

    results.sort(key=lambda r: (not r["inside_polygon"], r["distance_m"]))

    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "availability.json"
    json_path.write_text(
        json.dumps(
            {
                "checked_at": checked_at,
                "horizon_start": start.isoformat(),
                "horizon_end": end.isoformat(),
                "shelters": results,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    csv_path = out_dir / "shelters.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for result in results:
            writer.writerow(
                {
                    **result,
                    "shelter_name": result["name"],
                    "available_dates": ";".join(result["available_dates"]),
                }
            )

    logger.info(
        "wrote %s and %s: %d facilities, %d with free nights in the next %d months",
        json_path,
        csv_path,
        len(results),
        sum(r["n_available"] > 0 for r in results),
        months,
    )


# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #


def _regions(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split(","))


def _categories(value: str) -> dict[int, str]:
    known = udinaturen.OVERNIGHT_CATEGORIES
    chosen = {}
    for part in value.split(","):
        umb_id = int(part)
        if umb_id not in known:
            raise argparse.ArgumentTypeError(
                f"unknown category {umb_id}; known: "
                + ", ".join(f"{k} ({v})" for k, v in known.items())
            )
        chosen[umb_id] = known[umb_id]
    return chosen


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hundeskove",
        description="Shelters in Danish off-leash dog forests, and when they are free.",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_discover_flags(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--regions",
            type=_regions,
            default=udinaturen.ALL_REGIONS,
            help="comma-separated region ids (default: all five, 81-85)",
        )
        sub.add_argument(
            "--max-distance",
            type=float,
            default=500.0,
            help="metres from a dog forest a facility may be and still count (default: 500)",
        )
        sub.add_argument(
            "--categories",
            type=_categories,
            default=udinaturen.OVERNIGHT_CATEGORIES,
            help="comma-separated umbIds to include (default: 1115,1111,1112,1106)",
        )
        sub.add_argument(
            "--cache", type=Path, default=DEFAULT_CACHE, help="GUID -> place id cache file"
        )
        sub.add_argument(
            "--no-cache", action="store_true", help="ignore and do not write the cache"
        )
        sub.add_argument(
            "--osm-cache",
            type=Path,
            default=DEFAULT_OSM_CACHE,
            help="cached OSM dog parks used to fill missing dog-forest boundaries",
        )
        sub.add_argument(
            "--refresh-osm",
            action="store_true",
            help="re-query Overpass instead of using the cached dog parks",
        )

    def add_availability_flags(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--months",
            type=int,
            default=booking.BOOKING_HORIZON_MONTHS,
            help="how far ahead to look (default: 3, the booking limit)",
        )
        sub.add_argument(
            "--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="where to write results"
        )
        sub.add_argument(
            "--anchor-step",
            type=int,
            default=booking.DEFAULT_ANCHOR_STEP_MONTHS,
            help="months between calendar anchors; lower means more overlap (default: 2)",
        )

    serve_parser = subparsers.add_parser("serve", help="serve the built UI locally")
    serve_parser.add_argument("--port", type=int, default=8000)
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--ui-dir", type=Path, default=DEFAULT_UI_DIR)
    serve_parser.add_argument("--data-dir", type=Path, default=DEFAULT_OUT_DIR)

    for name in ("discover", "availability", "run"):
        sub = subparsers.add_parser(name)
        sub.add_argument(
            "--max-workers", type=int, default=8, help="concurrent HTTP requests"
        )
        if name in ("discover", "run"):
            add_discover_flags(sub)
        if name in ("availability", "run"):
            add_availability_flags(sub)
        if name == "discover":
            sub.add_argument("--out", type=Path, default=DEFAULT_CATALOGUE)
        if name == "availability":
            sub.add_argument("--shelters", type=Path, default=DEFAULT_CATALOGUE)
        if name == "run":
            sub.add_argument("--shelters", type=Path, default=DEFAULT_CATALOGUE)
            sub.add_argument(
                "--refresh-shelters",
                action="store_true",
                help="re-run discovery even if the catalogue already exists",
            )

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    # httpx2 logs a line per request; hundreds of those drown out our own output.
    logging.getLogger("httpx2").setLevel(logging.DEBUG if args.verbose else logging.WARNING)

    if args.command == "serve":
        serve_module.serve(args.ui_dir, args.data_dir, args.port, args.host)
    elif args.command == "discover":
        discover(
            regions=args.regions,
            categories=args.categories,
            max_distance_m=args.max_distance,
            out_path=args.out,
            cache_path=args.cache,
            use_cache=not args.no_cache,
            max_workers=args.max_workers,
            osm_cache_path=args.osm_cache,
            refresh_osm=args.refresh_osm,
        )
    elif args.command == "availability":
        check_availability(
            catalogue_path=args.shelters,
            months=args.months,
            out_dir=args.out_dir,
            max_workers=args.max_workers,
            anchor_step=args.anchor_step,
        )
    else:
        if args.refresh_shelters or not args.shelters.exists():
            discover(
                regions=args.regions,
                categories=args.categories,
                max_distance_m=args.max_distance,
                out_path=args.shelters,
                cache_path=args.cache,
                use_cache=not args.no_cache,
                max_workers=args.max_workers,
                osm_cache_path=args.osm_cache,
                refresh_osm=args.refresh_osm,
            )
        else:
            logger.info("reusing existing catalogue %s", args.shelters)
        check_availability(
            catalogue_path=args.shelters,
            months=args.months,
            out_dir=args.out_dir,
            max_workers=args.max_workers,
            anchor_step=args.anchor_step,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
