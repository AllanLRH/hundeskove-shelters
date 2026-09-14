"""Filling missing dog-forest boundaries from OpenStreetMap.

129 of 505 dog forests have no outline upstream. OSM can fill some of them, but
only where the answer is unambiguous — guessing would put a wrong boundary
behind an "inside the dog forest" claim, which is the one thing this project
must not get wrong.
"""

import pyproj
from shapely.geometry import Polygon
from shapely.ops import transform

from hundeskove import geo, osm
from tests.builders import facility, square

_to_utm32 = pyproj.Transformer.from_crs(4326, 25832, always_xy=True).transform


def park(x: float, y: float, size: float = 200, name: str = "OSM park") -> tuple:
    """A dog-park polygon already in UTM32, as `to_polygons` would produce."""
    return (
        Polygon(
            [(x, y), (x + size, y), (x + size, y + size), (x, y + size)]
        ),
        name,
    )


class TestFillMissingGeofences:
    def test_a_forest_that_already_has_a_boundary_is_left_alone(self, dog_forest):
        filled, count = osm.fill_missing_geofences([dog_forest], [park(0, 0)])
        assert count == 0
        assert filled[0]["geofence_source"] == "fkg"
        assert filled[0]["geometry"] == dog_forest["geometry"]

    def test_a_marker_inside_exactly_one_park_is_filled(self):
        marker = facility(id="m1", geometry=[[720100, 6180100]])
        filled, count = osm.fill_missing_geofences([marker], [park(720000, 6180000)])
        assert count == 1
        assert filled[0]["geofence_source"] == "osm"
        assert filled[0]["geometryType"] == "MultiPolygon"
        assert geo.has_boundary(filled[0])

    def test_a_marker_in_no_park_stays_a_marker(self):
        marker = facility(id="m1", geometry=[[999999, 6999999]])
        filled, count = osm.fill_missing_geofences([marker], [park(720000, 6180000)])
        assert count == 0
        assert filled[0]["geofence_source"] == "fkg"
        assert not geo.has_boundary(filled[0])

    def test_an_ambiguous_marker_is_left_unfilled(self):
        """Two overlapping parks cover the marker, so there is no single answer.

        Guessing here would attach a boundary that might be the wrong one.
        """
        marker = facility(id="m1", geometry=[[720100, 6180100]])
        parks = [park(720000, 6180000), park(720050, 6180050)]
        filled, count = osm.fill_missing_geofences([marker], parks)
        assert count == 0
        assert filled[0]["geofence_source"] == "fkg"

    def test_no_parks_at_all_is_survivable(self):
        """Overpass being unavailable must degrade, not crash."""
        marker = facility(id="m1", geometry=[[720100, 6180100]])
        filled, count = osm.fill_missing_geofences([marker], [])
        assert count == 0
        assert filled[0]["geofence_source"] == "fkg"


class TestToPolygons:
    def test_ways_with_too_few_nodes_are_skipped(self):
        assert osm.to_polygons([{"geometry": [{"lon": 12, "lat": 55}]}]) == []

    def test_a_closed_way_becomes_a_utm_polygon(self):
        way = {
            "geometry": [
                {"lon": 12.50, "lat": 55.70},
                {"lon": 12.51, "lat": 55.70},
                {"lon": 12.51, "lat": 55.71},
                {"lon": 12.50, "lat": 55.71},
            ],
            "tags": {"name": "Test park"},
        }
        [(polygon, name)] = osm.to_polygons([way])
        assert name == "Test park"
        assert polygon.area > 0
        # UTM32 metres for Denmark, not degrees.
        assert 400_000 < polygon.centroid.x < 900_000
