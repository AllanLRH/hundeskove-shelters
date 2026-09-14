"""Writing the generated files.

Kept separate from the pipeline so that what gets computed and what gets
written are not tangled together, and so the shapes can be asserted in tests
without running a fetch.
"""

import csv
import json
import logging
from pathlib import Path

from shapely.geometry import mapping

from . import geo
from .catalogue import CSV_COLUMNS

logger = logging.getLogger(__name__)

CATALOGUE_NAME = "shelters.json"
AVAILABILITY_NAME = "availability.json"
CSV_NAME = "shelters.csv"
GEOJSON_NAME = "dog_forests.geojson"


def _write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False), encoding="utf-8")


def write_catalogue(path: Path, catalogue: dict) -> None:
    _write_json(path, catalogue)


def write_availability(out_dir: Path, document: dict) -> Path:
    path = out_dir / AVAILABILITY_NAME
    _write_json(path, document)
    return path


def write_csv(out_dir: Path, results: list[dict]) -> Path:
    """The flat view, one row per facility.

    `available_dates` collapses to a `;`-separated string: a CSV cell cannot
    hold a list, and this keeps the file openable in a spreadsheet.
    """
    path = out_dir / CSV_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
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
    return path


def dog_forest_features(dog_forests: list[dict], matched_ids: set[str]) -> list[dict]:
    """GeoJSON features for the dog forests, reprojected to WGS84."""
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
    return features


def write_dog_forest_geojson(
    dog_forests: list[dict], matched_ids: set[str], out_dir: Path
) -> Path:
    """Export dog-forest outlines so the map can draw the off-leash zones.

    Every forest is written, not only the matched ones: the unmatched outlines
    are what let you see that a facility sits just outside a boundary rather
    than in open country.
    """
    features = dog_forest_features(dog_forests, matched_ids)
    path = out_dir / GEOJSON_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    # Compact rather than indented: this is machine-read only, and indenting
    # 505 polygons costs a lot of bytes for nobody's benefit.
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
