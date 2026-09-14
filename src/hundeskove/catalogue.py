"""Turning matches into catalogue records.

This is the one place that knows the *wire shape* of the output: the field
names in `output/shelters.json` and `shelters.csv`. They read as
`shelter_id`, `dog_forest_name` and so on for historical reasons — the project
started as a shelter finder before it covered four facility categories — and
are deliberately kept stable so existing links and scripts keep working. The
domain vocabulary lives in the code around this module; the translation to
those names happens here and nowhere else.
"""

from datetime import UTC, datetime

from . import booking, geo, osm

#: Column order for `shelters.csv`. `shelter_name` and the availability columns
#: are filled in by the availability stage, which is why they have no
#: counterpart in `facility_record`.
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
    "region",
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


def facility_record(
    proximity: geo.Proximity,
    place_id: int | None,
    booking_status: str,
) -> dict:
    """One catalogue row: a facility, the dog forest it matched, and its booking."""
    facility = proximity.facility
    easting, northing = geo.representative_coords(facility)
    lat, lon = geo.utm32_to_wgs84(easting, northing)

    return {
        "shelter_id": facility["id"],
        "name": facility["name"],
        "facility_type": facility["facility_type"],
        "umb_id": facility["umb_id"],
        "description": facility["description"],
        "dog_forest_name": proximity.dog_forest["name"],
        "dog_forest_id": proximity.dog_forest["id"],
        "distance_m": round(proximity.distance_m, 1),
        "inside_polygon": proximity.inside_polygon,
        "overlap_fraction": (
            None
            if proximity.overlap_fraction is None
            else round(proximity.overlap_fraction, 4)
        ),
        "dog_forest_has_boundary": geo.has_boundary(proximity.dog_forest),
        "geofence_source": proximity.dog_forest.get("geofence_source", "fkg"),
        "commune_code": facility["communeCode"],
        # udinaturen's own map can only be deep-linked at region granularity, so
        # the UI needs to know which region a facility is in to avoid opening
        # the whole country. Int, to match the --regions CLI flag rather than
        # the API's stringly-typed field.
        "region": int(facility["region"]),
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


def build_records(
    proximities: list[geo.Proximity],
    place_ids: dict[str, tuple[int | None, str]],
) -> list[dict]:
    """Catalogue rows for every match, in the order given."""
    return [
        facility_record(
            proximity,
            *place_ids.get(
                proximity.facility["id"], (None, booking.STATUS_NOT_BOOKABLE)
            ),
        )
        for proximity in proximities
    ]


def build_catalogue(
    records: list[dict],
    regions: tuple[int, ...],
    categories: dict[int, str],
    max_distance_m: float,
    geofences_filled: int,
) -> dict:
    """The full `shelters.json` document, records plus provenance."""
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "attribution": {
            "facilities": "udinaturen.dk / GeoFA-FKG",
            "geofence_gaps": osm.ATTRIBUTION,
        },
        "parameters": {
            "regions": list(regions),
            "categories": categories,
            "max_distance_m": max_distance_m,
            "geofences_filled_from_osm": geofences_filled,
        },
        "shelters": records,
    }
