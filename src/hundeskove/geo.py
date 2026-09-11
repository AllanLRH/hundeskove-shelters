"""Spatial join between shelters and dog forests.

All facility geometry from udinaturen.dk is EPSG:25832 (UTM 32N), so distances
are plain metres and no reprojection is needed for the join itself. WGS84 is
only produced for the human-facing output columns.
"""

import logging
from dataclasses import dataclass

import pyproj
from shapely.geometry import base, shape
from shapely.strtree import STRtree

logger = logging.getLogger(__name__)

UTM32 = 25832
WGS84 = 4326

_to_wgs84 = pyproj.Transformer.from_crs(UTM32, WGS84, always_xy=True)


@dataclass(frozen=True, slots=True)
class Match:
    """A shelter paired with the dog forest it belongs to (or sits closest to)."""

    shelter: dict
    dog_forest: dict
    distance_m: float
    inside_polygon: bool


def to_shapely(facility: dict) -> base.BaseGeometry:
    """Build a geometry from a facility record.

    The API's coordinate nesting already matches GeoJSON for the types it uses
    (MultiPoint for shelters, MultiPolygon or MultiPoint for dog forests).
    """
    return shape({"type": facility["geometryType"], "coordinates": facility["geometry"]})


def utm32_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """Convert UTM 32N coordinates to (latitude, longitude)."""
    lon, lat = _to_wgs84.transform(easting, northing)
    return lat, lon


def match_shelters(
    shelters: list[dict], dog_forests: list[dict], max_distance_m: float
) -> list[Match]:
    """Keep shelters inside, or within `max_distance_m` of, a dog forest.

    Distance is 0.0 for a shelter inside a polygon. `inside_polygon` says which
    of the two cases applies, so strict hits stay distinguishable from near ones.
    """
    forest_geoms = [to_shapely(forest) for forest in dog_forests]
    tree = STRtree(forest_geoms)

    matches: list[Match] = []
    for shelter in shelters:
        point = to_shapely(shelter)
        indices, distances = tree.query_nearest(
            point, max_distance=max_distance_m, return_distance=True, all_matches=False
        )
        if len(indices) == 0:
            continue

        index = int(indices[0])
        distance = float(distances[0])
        forest_geom = forest_geoms[index]
        inside = forest_geom.covers(point)
        matches.append(
            Match(
                shelter=shelter,
                dog_forest=dog_forests[index],
                distance_m=0.0 if inside else distance,
                inside_polygon=inside,
            )
        )

    logger.info(
        "%d of %d shelters matched (%d strictly inside a dog forest)",
        len(matches),
        len(shelters),
        sum(m.inside_polygon for m in matches),
    )
    return matches
