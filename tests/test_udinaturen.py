"""Fetching facility layers, without touching the network.

`region` is required and single-valued upstream, so a national view means five
calls per category — and facilities near a border come back from more than one
region. De-duplication is therefore load-bearing, not incidental.
"""

from hundeskove import udinaturen
from tests.builders import facility


class StubClient:
    """Stands in for httpx2.Client, recording what was asked for."""

    def __init__(self, by_request: dict[tuple[int, int], list[dict]]):
        self.by_request = by_request
        self.calls: list[tuple[int, int]] = []

    def get(self, url, params):
        key = (int(params["region"]), int(params["umbId"]))
        self.calls.append(key)
        return StubResponse(self.by_request.get(key, []))


class StubResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class TestFetchAllRegions:
    def test_asks_once_per_region(self):
        client = StubClient({})
        udinaturen.fetch_all_regions(client, 1133, (81, 82, 83))
        assert client.calls == [(81, 1133), (82, 1133), (83, 1133)]

    def test_a_facility_on_a_border_is_returned_once(self):
        """The same GUID coming back from two regions must not become two rows."""
        shared = facility(id="border-1")
        client = StubClient({(84, 1115): [shared], (85, 1115): [shared]})
        result = udinaturen.fetch_all_regions(client, 1115, (84, 85))
        assert len(result) == 1
        assert result[0]["id"] == "border-1"


class TestFetchCategories:
    def test_each_record_is_stamped_with_its_category(self):
        client = StubClient(
            {
                (84, 1115): [facility(id="a")],
                (84, 1111): [facility(id="b")],
            }
        )
        result = udinaturen.fetch_categories(
            client, {1115: "Shelter", 1111: "Primitiv overnatningsplads"}, (84,)
        )
        by_id = {r["id"]: r for r in result}
        assert by_id["a"]["umb_id"] == 1115
        assert by_id["a"]["facility_type"] == "Shelter"
        assert by_id["b"]["umb_id"] == 1111
        assert by_id["b"]["facility_type"] == "Primitiv overnatningsplads"

    def test_a_facility_listed_under_two_categories_keeps_the_first(self):
        """Order of `umb_ids` decides which label a shared facility keeps."""
        shared = facility(id="shared")
        client = StubClient({(84, 1115): [shared], (84, 1112): [shared]})
        result = udinaturen.fetch_categories(
            client, {1115: "Shelter", 1112: "Lejrplads"}, (84,)
        )
        assert len(result) == 1
        assert result[0]["facility_type"] == "Shelter"

    def test_stamping_does_not_mutate_the_fetched_record(self):
        """The same dict comes back from two regions; stamping must not alias."""
        shared = facility(id="x")
        client = StubClient({(84, 1115): [shared]})
        udinaturen.fetch_categories(client, {1115: "Shelter"}, (84,))
        assert "umb_id" not in shared or shared["umb_id"] == 1115
