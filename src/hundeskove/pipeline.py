"""The two stages, as orchestration only.

Deliberately separate, because their costs differ by orders of magnitude:
`discover` fetches two national facility layers, runs a spatial join and
scrapes booking ids, and its inputs barely change; `availability` only reads
the catalogue and hits one calendar endpoint. Refreshing when a place is free
should never re-run the geometry.

Everything here is I/O sequencing. The decisions live in `geo`, `booking`,
`osm` and `catalogue`, which are pure and tested directly.
"""

import json
import logging
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from pathlib import Path

import httpx2

from . import USER_AGENT
from . import booking, catalogue as catalogue_mod, geo, osm, outputs, udinaturen

logger = logging.getLogger(__name__)


def make_client() -> httpx2.Client:
    return httpx2.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=30.0,
        follow_redirects=True,
    )


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
    """Find facilities in or near a dog forest, and resolve their booking ids."""
    with make_client() as client:
        dog_forests = udinaturen.fetch_all_regions(
            client, udinaturen.DOG_FOREST_UMB_ID, regions
        )
        facilities = udinaturen.fetch_categories(client, categories, regions)
        logger.info("%d dog forests, %d facilities", len(dog_forests), len(facilities))

        parks = osm.to_polygons(osm.fetch_dog_parks(osm_cache_path, refresh_osm))
        dog_forests, filled = osm.fill_missing_geofences(dog_forests, parks)

        proximities = geo.match_facilities(facilities, dog_forests, max_distance_m)
        proximities.sort(key=lambda p: (not p.inside_polygon, p.distance_m))

        bookable_guids = [p.facility["id"] for p in proximities if p.facility["booking"]]
        cache = booking.PlaceIdCache(cache_path, enabled=use_cache)
        place_ids = booking.resolve_place_ids(client, bookable_guids, cache, max_workers)

    records = catalogue_mod.build_records(proximities, place_ids)
    catalogue = catalogue_mod.build_catalogue(
        records, regions, categories, max_distance_m, filled
    )

    outputs.write_catalogue(out_path, catalogue)
    outputs.write_dog_forest_geojson(
        dog_forests, {r["dog_forest_id"] for r in records}, out_path.parent
    )
    _log_discovery(out_path, records)
    return catalogue


def _log_discovery(out_path: Path, records: list[dict]) -> None:
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


def check_availability(
    catalogue_path: Path,
    months: int,
    out_dir: Path,
    max_workers: int,
    anchor_step: int,
) -> None:
    """Refresh which nights each bookable facility is free."""
    if not catalogue_path.exists():
        raise SystemExit(
            f"No facility catalogue at {catalogue_path}. "
            "Run `hundeskove discover` first."
        )

    records = json.loads(catalogue_path.read_text(encoding="utf-8"))["shelters"]

    start = date.today()
    end = booking.horizon_end(start, months)
    logger.info("checking availability for %s .. %s", start, end)

    booked_by_id = _fetch_booked(records, start, end, max_workers, anchor_step)
    checked_at = datetime.now(UTC).isoformat()
    results = _apply_availability(records, booked_by_id, start, end, checked_at)

    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = outputs.write_availability(
        out_dir,
        {
            "checked_at": checked_at,
            "horizon_start": start.isoformat(),
            "horizon_end": end.isoformat(),
            "shelters": results,
        },
    )
    csv_path = outputs.write_csv(out_dir, results)

    logger.info(
        "wrote %s and %s: %d facilities, %d with free nights in the next %d months",
        json_path,
        csv_path,
        len(results),
        sum(r["n_available"] > 0 for r in results),
        months,
    )


def _fetch_booked(
    records: list[dict],
    start: date,
    end: date,
    max_workers: int,
    anchor_step: int,
) -> dict[str, set[date]]:
    """Booked dates per facility, for the ones that have a calendar at all."""
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

    return {
        record["shelter_id"]: booked
        for record, booked in zip(with_place_id, booked_per_facility)
    }


def _apply_availability(
    records: list[dict],
    booked_by_id: dict[str, set[date]],
    start: date,
    end: date,
    checked_at: str,
) -> list[dict]:
    """Merge booked dates into the catalogue rows. Pure, so it is testable.

    A facility with no entry in `booked_by_id` has no calendar at all — it is
    free/first-come or booked elsewhere — which is not the same as having no
    free nights, so it gets an empty list and the UI reads `booking_status` to
    tell the two apart.
    """
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
    return results
