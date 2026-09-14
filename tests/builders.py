"""Builders for udinaturen-shaped records.

Every geometry here is a minimal reproduction of something the real data
actually contains — the degenerate rings and self-intersections are not
hypothetical, they are what Kalvebod hundehegn and Hundeskov ved Fasterholt
look like. Keeping them synthetic means the suite runs offline and does not
drift when the upstream data is refreshed.
"""


def facility(
    id: str = "f1",
    name: str = "Test shelter",
    geometry: list | None = None,
    geometry_type: str = "MultiPoint",
    **extra,
) -> dict:
    """A udinaturen facility record, shaped as the API returns one."""
    record = {
        "id": id,
        "name": name,
        "geometryType": geometry_type,
        "geometry": geometry if geometry is not None else [[720000, 6180000]],
        "description": "",
        "communeCode": 101,
        "region": "84",
        "ansvar_Org": "Naturstyrelsen Test",
        "booking": False,
        "umb_id": 1115,
        "facility_type": "Shelter",
    }
    record.update(extra)
    return record


def square(x: float, y: float, size: float = 100) -> list:
    """A closed square ring, as MultiPolygon coordinates."""
    return [[[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]]


def point_stub(x: float = 720500, y: float = 6180500) -> list:
    """A zero-area ring of one repeated point, as the real data contains."""
    return [[[x, y], [x, y], [x, y], [x, y]]]
