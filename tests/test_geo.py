"""The geometry repairs, every one of which fixed a real bug.

`clean_geometry` exists because GEOS predicates on invalid geometry are
undefined, and because the dog-forest layer ships two specific kinds of junk.
Both are reproduced in the fixtures.
"""

import pytest

from hundeskove import geo
from tests.builders import facility, point_stub, square


class TestCleanGeometry:
    def test_plain_polygon_survives_untouched(self, dog_forest):
        assert geo.clean_geometry(dog_forest).area == 100 * 100

    def test_zero_area_stubs_are_dropped(self, degenerate_forest):
        """The real polygon survives; the point-stubs contribute nothing.

        Left in, they make the geometry mixed-dimension and make_valid raises.
        """
        cleaned = geo.clean_geometry(degenerate_forest)
        assert cleaned.is_valid
        assert cleaned.area == 100 * 100

    def test_self_intersection_leaves_no_dangling_line(self, self_intersecting_forest):
        """A repaired bow-tie must be area only.

        A leftover LineString would take part in covers() and distance(), so a
        facility could be measured against a spur rather than against the area.
        """
        cleaned = geo.clean_geometry(self_intersecting_forest)
        assert cleaned.is_valid
        parts = list(getattr(cleaned, "geoms", [cleaned]))
        assert all(part.area > 0 for part in parts)
        assert cleaned.geom_type in {"Polygon", "MultiPolygon"}

    def test_all_degenerate_falls_back_to_points(self):
        """A forest with no real polygon must not vanish; it stays matchable."""
        cleaned = geo.clean_geometry(
            facility(
                geometry_type="MultiPolygon",
                geometry=[point_stub(), point_stub(1, 1)],
            )
        )
        assert cleaned.geom_type == "MultiPoint"
        assert not cleaned.is_empty


class TestHasBoundary:
    def test_polygon_has_one(self, dog_forest):
        assert geo.has_boundary(dog_forest)

    def test_bare_marker_does_not(self):
        assert not geo.has_boundary(facility(geometry_type="MultiPoint"))

    def test_zero_area_polygon_does_not(self):
        assert not geo.has_boundary(
            facility(geometry_type="MultiPolygon", geometry=[point_stub()])
        )


class TestRepresentativeCoords:
    def test_point_facility(self):
        assert geo.representative_coords(facility(geometry=[[720000, 6180000]])) == (
            720000,
            6180000,
        )

    def test_polygon_facility_lands_inside(self, dog_forest):
        """This is what crashed before: geometry[0] is a ring, not a coordinate."""
        x, y = geo.representative_coords(dog_forest)
        assert 720000 <= x <= 720100
        assert 6180000 <= y <= 6180100


class TestMatchFacilities:
    def test_facility_inside_reports_zero_distance(self, dog_forest):
        inside = facility(geometry=[[720050, 6180050]])
        [proximity] = geo.match_facilities([inside], [dog_forest], 500)
        assert proximity.inside_polygon
        assert proximity.distance_m == 0.0
        assert proximity.overlap_fraction is None  # a point has no area to share

    def test_facility_outside_but_near_reports_its_distance(self, dog_forest):
        near = facility(geometry=[[720000 - 50, 6180050]])
        [proximity] = geo.match_facilities([near], [dog_forest], 500)
        assert not proximity.inside_polygon
        assert proximity.distance_m == pytest.approx(50, abs=1)

    def test_facility_beyond_the_cutoff_is_dropped(self, dog_forest):
        far = facility(geometry=[[720000 - 5000, 6180050]])
        assert geo.match_facilities([far], [dog_forest], 500) == []

    def test_area_facility_overlapping_is_not_inside(self, dog_forest):
        """An area straddling the boundary overlaps without being contained.

        This is why distance alone cannot express the relationship: it is 0 m
        away and still not inside.
        """
        straddling = facility(
            geometry_type="MultiPolygon", geometry=square(720050, 6180050, 100)
        )
        [proximity] = geo.match_facilities([straddling], [dog_forest], 500)
        assert not proximity.inside_polygon
        assert proximity.distance_m == 0.0
        assert 0 < proximity.overlap_fraction < 1
