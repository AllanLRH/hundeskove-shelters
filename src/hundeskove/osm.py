"""Dog-park boundaries from OpenStreetMap, to fill gaps in the Danish data.

129 of the 505 Danish dog forests are mapped as a bare marker point with no
outline. That gap is real upstream, not an artefact of udinaturen: GeoFA/FKG
(`geofa.geodanmark.dk`, `fkg.t_5801_fac_fl`, `facil_ty_k = 1191`) holds exactly
the same 129 points and 376 polygons.

OSM's `leisure=dog_park` is a good stand-in where it exists. Measured against
the 376 forests that do have an FKG boundary, the two agree at a median IoU of
0.89 — they describe the same fences. It covers 52 of the 129 gaps.

Two approaches were rejected and should not be retried without new evidence:

* udinaturen category 1124 "Rekreative naturområder" is a median 28x larger than
  the dog forest it contains (max 10,459x). It is the whole forest, not the
  off-leash zone.
* Subdividing that enclosing polygon by OSM roads reaches only median IoU 0.215,
  still ~5x too large, and errs toward false "inside" claims.

Data: (c) OpenStreetMap contributors, ODbL.
"""

import json
import logging
from pathlib import Path

import httpx2
from shapely.geometry import Polygon
from shapely.ops import transform
from shapely.strtree import STRtree

from .geo import has_boundary, to_shapely, wgs84_to_utm32_shape

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

#: Ways only. The 16 `relation` dog parks need multipolygon member assembly,
#: which buys too little here to be worth the complexity.
OVERPASS_QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="DK"][admin_level=2]->.dk;
(way["leisure"="dog_park"](area.dk););
out geom tags;
"""

ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"

logger = logging.getLogger(__name__)


def fetch_dog_parks(cache_path: Path, refresh: bool = False) -> list[dict]:
    """Danish `leisure=dog_park` ways, cached on disk.

    Overpass is slow and aggressively rate-limited, so the cache is not really
    optional. A failed fetch is a soft failure: callers carry on with FKG-only
    geometry rather than losing a whole run to someone else's quota.
    """
    if cache_path.exists() and not refresh:
        elements = json.loads(cache_path.read_text(encoding="utf-8"))["elements"]
        logger.info("loaded %d OSM dog parks from %s", len(elements), cache_path)
        return elements

    logger.info("querying Overpass for Danish dog parks (this is slow)")
    try:
        with httpx2.Client(
            timeout=200.0, headers={"User-Agent": "hundeskove/0.1 (+dog forest mapping)"}
        ) as client:
            response = client.post(OVERPASS_URL, data={"data": OVERPASS_QUERY})
            response.raise_for_status()
            payload = response.json()
    except (httpx2.HTTPError, ValueError) as exc:
        logger.warning("Overpass unavailable (%s); continuing without OSM geofences", exc)
        return []

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(payload), encoding="utf-8")
    logger.info("cached %d OSM dog parks to %s", len(payload["elements"]), cache_path)
    return payload["elements"]


def to_polygons(elements: list[dict]) -> list[tuple[Polygon, str]]:
    """Usable polygons in EPSG:25832, paired with their OSM name."""
    polygons = []
    for element in elements:
        nodes = element.get("geometry") or []
        if len(nodes) < 4:
            continue
        polygon = Polygon([(n["lon"], n["lat"]) for n in nodes])
        if not polygon.is_valid:
            # OSM ways are not guaranteed simple; self-touching outlines are common.
            polygon = polygon.buffer(0)
        if polygon.is_empty or polygon.area == 0:
            continue
        polygons.append(
            (wgs84_to_utm32_shape(polygon), element.get("tags", {}).get("name", ""))
        )
    return polygons


def fill_missing_geofences(
    dog_forests: list[dict], parks: list[tuple[Polygon, str]]
) -> tuple[list[dict], int]:
    """Give boundary-less dog forests an outline from OSM where one clearly applies.

    A forest is filled only when exactly one dog park covers its marker. More than
    one candidate means the marker sits in an ambiguous cluster, and guessing there
    would be worse than leaving the gap visible.
    """
    filled = 0
    result = []
    geometries = [polygon for polygon, _ in parks]
    tree = STRtree(geometries) if geometries else None

    for forest in dog_forests:
        if has_boundary(forest) or tree is None:
            result.append(forest | {"geofence_source": "fkg"})
            continue

        # STRtree applies the predicate as input.predicate(tree_geometry), so this
        # asks which parks contain the forest's marker.
        indices = tree.query(to_shapely(forest), predicate="covered_by")
        if len(indices) != 1:
            result.append(forest | {"geofence_source": "fkg"})
            continue

        polygon, name = parks[int(indices[0])]
        result.append(
            forest
            | {
                "geometryType": "MultiPolygon",
                "geometry": [[[list(coord) for coord in polygon.exterior.coords]]],
                "geofence_source": "osm",
                "osm_name": name,
            }
        )
        filled += 1

    logger.info(
        "filled %d of %d boundary-less dog forests from OSM",
        filled,
        sum(1 for f in dog_forests if not has_boundary(f)),
    )
    return result, filled
