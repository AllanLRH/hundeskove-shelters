"""Spatial join between overnight facilities and dog forests.

All facility geometry from udinaturen.dk is EPSG:25832 (UTM 32N), so distances
are plain metres and no reprojection is needed for the join itself. WGS84 is
only produced for the human-facing output columns.
"""

import logging
from dataclasses import dataclass

import pyproj
from shapely import make_valid
from shapely.geometry import MultiPoint, base, shape
from shapely.ops import transform
from shapely.strtree import STRtree

logger = logging.getLogger(__name__)

UTM32 = 25832
WGS84 = 4326

_to_wgs84 = pyproj.Transformer.from_crs(UTM32, WGS84, always_xy=True)
_to_utm32 = pyproj.Transformer.from_crs(WGS84, UTM32, always_xy=True)


@dataclass(frozen=True, slots=True)
class Match:
    """A facility paired with the dog forest it belongs to (or sits closest to)."""

    facility: dict
    dog_forest: dict
    distance_m: float
    inside_polygon: bool
    #: Share of an *area* facility lying inside the dog forest. None for points,
    #: where containment already says everything there is to say.
    overlap_fraction: float | None = None


def to_shapely(facility: dict) -> base.BaseGeometry:
    """Build a geometry from a facility record, exactly as the API states it.

    The API's coordinate nesting already matches GeoJSON for the types it uses
    (MultiPoint for most facilities, MultiPolygon or MultiPoint for dog forests).
    """
    return shape({"type": facility["geometryType"], "coordinates": facility["geometry"]})


def clean_geometry(facility: dict) -> base.BaseGeometry:
    """Build a geometry fit to run predicates against.

    The dog-forest layer contains two kinds of junk that must be handled before
    any `covers`/`distance` call:

    * Zero-area polygon components written as a ring of one repeated point, e.g.
      ``[[p, p, p, p]]``. Nine of Kalvebod hundehegn's ten polygons are these.
      They carry no information, and mixing them with real polygons makes the
      geometry mixed-dimension, which crashes `make_valid` outright.
    * Self-intersecting rings (15 forests). GEOS predicates on an invalid
      geometry are undefined, so they must be repaired rather than trusted.

    Components are dropped only when something real survives; a facility whose
    every component is degenerate falls back to its points, so it can still be
    matched by distance instead of vanishing.
    """
    if facility["geometryType"] != "MultiPolygon":
        return to_shapely(facility)

    kept = [
        polygon
        for polygon in facility["geometry"]
        if shape({"type": "Polygon", "coordinates": polygon}).area > 0
    ]
    if not kept:
        points = [tuple(point) for polygon in facility["geometry"] for point in polygon[0]]
        logger.debug("%r has no polygon with area; using its points", facility["name"])
        return MultiPoint(sorted(set(points)))

    geometry = shape({"type": "MultiPolygon", "coordinates": kept})
    if not geometry.is_valid:
        logger.debug("repairing invalid geometry for %r", facility["name"])
        geometry = make_valid(geometry)
    return geometry


def has_boundary(facility: dict) -> bool:
    """Whether this facility has a real outline, rather than a single marker.

    129 of 505 dog forests are mapped as a bare MultiPoint. A shelter can never
    be reported inside one of those, and its distance is measured to a marker
    rather than to an edge.
    """
    return facility["geometryType"] == "MultiPolygon" and any(
        shape({"type": "Polygon", "coordinates": polygon}).area > 0
        for polygon in facility["geometry"]
    )


def utm32_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """Convert UTM 32N coordinates to (latitude, longitude)."""
    lon, lat = _to_wgs84.transform(easting, northing)
    return lat, lon


def wgs84_to_utm32_shape(geometry: base.BaseGeometry) -> base.BaseGeometry:
    """Reproject a lon/lat geometry into UTM 32N, so it can join the facility data."""
    return transform(_to_utm32.transform, geometry)


def representative_coords(facility: dict) -> tuple[float, float]:
    """A single (easting, northing) standing in for a facility of any shape.

    Most facilities are a single point, but not all: two shelters, 17 Lejrpladser
    and 313 Frit teltningsområder are polygons. `representative_point` handles
    every case and is guaranteed to lie inside the geometry, unlike a centroid.
    """
    point = clean_geometry(facility).representative_point()
    return point.x, point.y


def match_facilities(
    facilities: list[dict], dog_forests: list[dict], max_distance_m: float
) -> list[Match]:
    """Keep facilities inside, or within `max_distance_m` of, a dog forest.

    Distance is 0.0 for a facility inside a polygon. `inside_polygon` says which
    of the two cases applies, so strict hits stay distinguishable from near ones.

    For a facility that is itself an area, containment is the wrong question — a
    Frit teltningsområde is essentially never wholly inside a dog forest, though
    79 of 124 overlap one. Those carry `overlap_fraction` instead.
    """
    forest_geoms = [clean_geometry(forest) for forest in dog_forests]
    tree = STRtree(forest_geoms)

    matches: list[Match] = []
    for facility in facilities:
        geometry = clean_geometry(facility)
        indices, distances = tree.query_nearest(
            geometry, max_distance=max_distance_m, return_distance=True, all_matches=False
        )
        if len(indices) == 0:
            continue

        index = int(indices[0])
        distance = float(distances[0])
        forest_geom = forest_geoms[index]
        inside = forest_geom.covers(geometry)
        overlap = None
        if geometry.area > 0:
            overlap = forest_geom.intersection(geometry).area / geometry.area
        matches.append(
            Match(
                facility=facility,
                dog_forest=dog_forests[index],
                distance_m=0.0 if inside else distance,
                inside_polygon=inside,
                overlap_fraction=overlap,
            )
        )

    boundless = sum(not has_boundary(m.dog_forest) for m in matches)
    logger.info(
        "%d of %d facilities matched (%d strictly inside a dog forest)",
        len(matches),
        len(facilities),
        sum(m.inside_polygon for m in matches),
    )
    if boundless:
        logger.warning(
            "%d matches are against a dog forest mapped as a bare point, so their "
            "distance is to a marker and they can never register as inside",
            boundless,
        )
    return matches
