import pytest

from tests.builders import facility, point_stub, square


@pytest.fixture
def dog_forest() -> dict:
    """A plain 100 m square dog forest with a real boundary."""
    return facility(
        id="forest1",
        name="Test hundeskov",
        geometry=square(720000, 6180000),
        geometry_type="MultiPolygon",
    )


@pytest.fixture
def degenerate_forest() -> dict:
    """Kalvebod's shape: one real polygon among zero-area point-stubs.

    Mixing these makes the geometry mixed-dimension, which crashes make_valid
    outright, so `clean_geometry` has to drop them before repairing.
    """
    return facility(
        id="forest-degenerate",
        name="Kalvebod-like",
        geometry_type="MultiPolygon",
        geometry=[square(720000, 6180000)[0], point_stub(), point_stub()],
    )


@pytest.fixture
def self_intersecting_forest() -> dict:
    """A bow-tie ring: repairing it leaves a dangling spur behind."""
    return facility(
        id="forest-bowtie",
        name="Fasterholt-like",
        geometry_type="MultiPolygon",
        geometry=[[[[0, 0], [100, 100], [100, 0], [0, 100], [0, 0]]]],
    )
