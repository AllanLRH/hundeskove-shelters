"""Record shaping: the translation from domain values to the output wire format.

The field names here (`shelter_id`, `dog_forest_name`) are historical and
deliberately frozen so existing links and scripts keep working. This module is
the only place that knows them, so this is the only place that can break them.
"""

from hundeskove import booking, catalogue, geo
from tests.builders import facility, square


def proximity(**overrides) -> geo.Proximity:
    defaults = {
        "facility": facility(geometry=[[720050, 6180050]]),
        "dog_forest": facility(
            id="forest1",
            name="Test hundeskov",
            geometry=square(720000, 6180000),
            geometry_type="MultiPolygon",
        ),
        "distance_m": 0.0,
        "inside_polygon": True,
        "overlap_fraction": None,
    }
    return geo.Proximity(**{**defaults, **overrides})


class TestFacilityRecord:
    def test_carries_the_frozen_wire_field_names(self):
        record = catalogue.facility_record(proximity(), 42, booking.STATUS_RESOLVED)
        for field in (
            "shelter_id",
            "dog_forest_name",
            "distance_m",
            "inside_polygon",
            "booking_status",
            "place_id",
            "lat",
            "lon",
        ):
            assert field in record, f"{field} missing — this breaks the UI and the CSV"

    def test_region_is_an_int_not_the_apis_string(self):
        """The API returns "84"; the CLI's --regions flag speaks ints."""
        record = catalogue.facility_record(
            proximity(), None, booking.STATUS_NOT_BOOKABLE
        )
        assert record["region"] == 84
        assert isinstance(record["region"], int)

    def test_coordinates_land_in_denmark(self):
        record = catalogue.facility_record(
            proximity(), None, booking.STATUS_NOT_BOOKABLE
        )
        assert 54.4 <= record["lat"] <= 57.9
        assert 7.9 <= record["lon"] <= 15.4

    def test_an_area_facility_carries_its_overlap(self):
        record = catalogue.facility_record(
            proximity(inside_polygon=False, distance_m=0.0, overlap_fraction=0.1234567),
            None,
            booking.STATUS_NOT_BOOKABLE,
        )
        assert record["overlap_fraction"] == 0.1235
        assert record["inside_polygon"] is False

    def test_a_point_facility_has_no_overlap(self):
        record = catalogue.facility_record(
            proximity(), None, booking.STATUS_NOT_BOOKABLE
        )
        assert record["overlap_fraction"] is None

    def test_booking_url_is_built_from_the_guid(self):
        record = catalogue.facility_record(proximity(), 42, booking.STATUS_RESOLVED)
        assert record["booking_url"].endswith(record["shelter_id"])


class TestBuildRecords:
    def test_unresolved_facilities_default_to_not_bookable(self):
        [record] = catalogue.build_records([proximity()], {})
        assert record["place_id"] is None
        assert record["booking_status"] == booking.STATUS_NOT_BOOKABLE

    def test_place_ids_are_matched_by_facility_id(self):
        p = proximity()
        place_ids = {p.facility["id"]: (7, booking.STATUS_RESOLVED)}
        [record] = catalogue.build_records([p], place_ids)
        assert record["place_id"] == 7
        assert record["booking_status"] == booking.STATUS_RESOLVED

    def test_order_is_preserved(self):
        ps = [proximity(facility=facility(id=f"f{i}")) for i in range(3)]
        records = catalogue.build_records(ps, {})
        assert [r["shelter_id"] for r in records] == ["f0", "f1", "f2"]


class TestBuildCatalogue:
    def test_records_live_under_the_shelters_key(self):
        """Frozen: the UI and check_outputs.py both read `shelters`."""
        document = catalogue.build_catalogue([], (84,), {1115: "Shelter"}, 500.0, 0)
        assert "shelters" in document

    def test_provenance_is_recorded(self):
        document = catalogue.build_catalogue([], (84, 85), {1115: "Shelter"}, 500.0, 52)
        assert document["parameters"]["regions"] == [84, 85]
        assert document["parameters"]["max_distance_m"] == 500.0
        assert document["parameters"]["geofences_filled_from_osm"] == 52
        assert "OpenStreetMap" in document["attribution"]["geofence_gaps"]
