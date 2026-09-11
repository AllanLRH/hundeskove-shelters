"""Facility layers from udinaturen.dk.

Both layers come back in EPSG:25832 (UTM zone 32N) with GeoJSON coordinate
nesting, so shelters and dog forests can be compared without reprojection.
"""

import logging

import httpx2

API_URL = "https://udinaturen.dk/api/map/categories/GetCategoriesByUmbId"

DOG_FOREST_UMB_ID = 1133

#: The categories behind the site's own "Overnat i naturen" activity filter,
#: which resolves to categories=1111,1112,1115,1106. Shelters alone miss a lot:
#: 1111 yields more strictly-inside hits than 1115 does, from a sixth as many
#: facilities.
OVERNIGHT_CATEGORIES = {
    1115: "Shelter",
    1111: "Primitiv overnatningsplads",
    1112: "Lejrplads",
    1106: "Frit teltningsområde",
}

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


def fetch_categories(
    client: httpx2.Client,
    umb_ids: dict[int, str],
    regions: tuple[int, ...] = ALL_REGIONS,
) -> list[dict]:
    """Fetch several categories, stamping each record with the one it came from.

    De-duplication spans categories as well as regions: a facility may legitimately
    be listed under more than one, and the first category wins so that the order of
    `umb_ids` decides which label a shared facility keeps.
    """
    by_id: dict[str, dict] = {}
    for umb_id, label in umb_ids.items():
        for facility in fetch_all_regions(client, umb_id, regions):
            if facility["id"] in by_id:
                continue
            by_id[facility["id"]] = facility | {"umb_id": umb_id, "facility_type": label}
    logger.info("%d facilities across %d categories", len(by_id), len(umb_ids))
    return list(by_id.values())
