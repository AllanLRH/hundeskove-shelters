"""Facility layers from udinaturen.dk.

Both layers come back in EPSG:25832 (UTM zone 32N) with GeoJSON coordinate
nesting, so shelters and dog forests can be compared without reprojection.
"""

import logging

import httpx2

API_URL = "https://udinaturen.dk/api/map/categories/GetCategoriesByUmbId"

DOG_FOREST_UMB_ID = 1133
SHELTER_UMB_ID = 1115

# The five Danish regions. `region` is required and takes a single value.
ALL_REGIONS = (81, 82, 83, 84, 85)

logger = logging.getLogger(__name__)


def fetch_facilities(client: httpx2.Client, umb_id: int, region: int) -> list[dict]:
    """Fetch every facility of one category within one region."""
    response = client.get(
        API_URL,
        params={
            "region": region,
            "umbId": umb_id,
            "organisation": "",
            "kommunekoder": "",
        },
    )
    response.raise_for_status()
    return response.json()


def fetch_all_regions(
    client: httpx2.Client, umb_id: int, regions: tuple[int, ...] = ALL_REGIONS
) -> list[dict]:
    """Fetch one category across regions, de-duplicated by facility id.

    Facilities near a region border are returned by more than one region.
    """
    by_id: dict[str, dict] = {}
    for region in regions:
        facilities = fetch_facilities(client, umb_id, region)
        logger.info("region %s, umbId %s: %d facilities", region, umb_id, len(facilities))
        for facility in facilities:
            by_id.setdefault(facility["id"], facility)
    return list(by_id.values())
