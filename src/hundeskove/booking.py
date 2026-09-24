"""Booking place ids and availability from book.naturstyrelsen.dk.

Two endpoints are involved:

* ``/sted/?id={guid}`` redirects to a slug page whose hidden ``PID`` field is
  the numeric place id. The booking site indexes the same udinaturen GUIDs, so
  no name matching is needed. The page is Latin-1 encoded.
* ``inc_ajaxgetbookingsforsingleplace.asp?i={pid}&d={YYYYMMDD}`` reports the
  dates that are *taken*; availability is the complement.
"""

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import httpx2

BASE_URL = "https://book.naturstyrelsen.dk"
PLACE_URL = f"{BASE_URL}/sted/"
CALENDAR_URL = (
    f"{BASE_URL}/includes/branding_files/shelterbooking/includes"
    "/inc_ajaxgetbookingsforsingleplace.asp"
)

# Naturstyrelsen does not accept bookings further ahead than this.
BOOKING_HORIZON_MONTHS = 3

# A calendar response covers the month of `d` plus one month either side, so
# consecutive anchors two months apart overlap by a month.
ANCHOR_WINDOW_HALF_MONTHS = 1
DEFAULT_ANCHOR_STEP_MONTHS = 2

_PID_RE = re.compile(r'name="PID"\s+value="(\d+)"')

logger = logging.getLogger(__name__)


def place_url(guid: str) -> str:
    """The public booking page for a shelter, keyed by its udinaturen GUID."""
    return f"{PLACE_URL}?id={guid}"


def _get(client: httpx2.Client, url: str, params: dict, attempts: int = 3):
    """GET with a couple of retries, so one flaky connection does not kill a run."""
    for attempt in range(1, attempts + 1):
        try:
            response = client.get(url, params=params)
            response.raise_for_status()
            return response
        except (httpx2.TransportError, httpx2.HTTPStatusError) as exc:
            if attempt == attempts:
                raise
            logger.debug("retrying %s (%s): %s", url, attempt, exc)
            time.sleep(0.5 * attempt)
    raise AssertionError("unreachable")


#: Outcome of a place id lookup, recorded per shelter so the output explains
#: itself. Only Naturstyrelsen sites live in this booking system; municipal and
#: privately run shelters are flagged `booking: true` by udinaturen but are
#: reserved elsewhere, which is a fact about the shelter, not a failure.
STATUS_RESOLVED = "naturstyrelsen"
STATUS_OTHER_OPERATOR = "other_operator"
STATUS_LOOKUP_ERROR = "lookup_error"
STATUS_NOT_BOOKABLE = "not_bookable"


def resolve_place_id(client: httpx2.Client, guid: str) -> tuple[int | None, str]:
    """Look up the numeric booking place id for a shelter GUID.

    Returns the id and a status explaining the outcome.
    """
    try:
        response = _get(client, PLACE_URL, {"id": guid})
    except httpx2.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            # The GUID redirects to a slug the booking system does not serve.
            logger.debug("no booking page for %s (404)", guid)
            return None, STATUS_OTHER_OPERATOR
        logger.warning("place lookup failed for %s: %s", guid, exc)
        return None, STATUS_LOOKUP_ERROR
    except httpx2.HTTPError as exc:
        logger.warning("place lookup failed for %s: %s", guid, exc)
        return None, STATUS_LOOKUP_ERROR

    match = _PID_RE.search(response.content.decode("latin-1"))
    if match is None:
        # Redirected to the front page: unknown to this booking system.
        logger.debug("no PID on booking page for %s (%s)", guid, response.url)
        return None, STATUS_OTHER_OPERATOR
    return int(match.group(1)), STATUS_RESOLVED


class PlaceIdCache:
    """On-disk GUID -> place id cache.

    The mapping is stable, and scraping it is by far the slowest step, so a
    repeat run of `discover` should not pay for it again.
    """

    def __init__(self, path: Path, enabled: bool = True) -> None:
        self.path = path
        self.enabled = enabled
        self._entries: dict[str, list] = {}
        if enabled and path.exists():
            self._entries = json.loads(path.read_text(encoding="utf-8"))
            logger.info("loaded %d cached place ids from %s", len(self._entries), path)

    def __contains__(self, guid: str) -> bool:
        # A transport hiccup must not be cached as a permanent answer.
        return (
            self.enabled
            and guid in self._entries
            and self._entries[guid][1] != STATUS_LOOKUP_ERROR
        )

    def __getitem__(self, guid: str) -> tuple[int | None, str]:
        place_id, status = self._entries[guid]
        return place_id, status

    def __setitem__(self, guid: str, result: tuple[int | None, str]) -> None:
        self._entries[guid] = list(result)

    def save(self) -> None:
        if not self.enabled:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._entries, indent=2), encoding="utf-8")


def resolve_place_ids(
    client: httpx2.Client,
    guids: list[str],
    cache: PlaceIdCache,
    max_workers: int = 8,
) -> dict[str, tuple[int | None, str]]:
    """Resolve many GUIDs concurrently, consulting and updating the cache."""
    missing = [guid for guid in guids if guid not in cache]
    logger.info(
        "resolving %d place ids (%d cached)", len(missing), len(guids) - len(missing)
    )

    if missing:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            for guid, result in zip(
                missing, pool.map(lambda g: resolve_place_id(client, g), missing)
            ):
                cache[guid] = result
        cache.save()

    return {guid: cache[guid] for guid in guids}


def _add_months(day: date, months: int) -> date:
    """Shift by whole months, landing on the first of the target month."""
    total = (day.year * 12 + day.month - 1) + months
    return date(total // 12, total % 12 + 1, 1)


def _end_of_month(day: date) -> date:
    return _add_months(day, 1) - timedelta(days=1)


def month_anchors(
    start: date, end: date, step_months: int = DEFAULT_ANCHOR_STEP_MONTHS
) -> list[date]:
    """Anchor dates whose calendar windows together cover [start, end].

    The API keys its window off the *month* of the anchor, ignoring the day, and
    spans that month plus one either side.
    """
    anchors = [start.replace(day=1)]
    while _end_of_month(_add_months(anchors[-1], ANCHOR_WINDOW_HALF_MONTHS)) < end:
        anchors.append(_add_months(anchors[-1], step_months))
    return anchors


def fetch_booked_dates(
    client: httpx2.Client,
    place_id: int,
    start: date,
    end: date,
    step_months: int = DEFAULT_ANCHOR_STEP_MONTHS,
) -> set[date]:
    """Every date in [start, end] that is already taken at this place."""
    booked: set[date] = set()
    for anchor in month_anchors(start, end, step_months):
        response = _get(
            client, CALENDAR_URL, {"i": place_id, "d": anchor.strftime("%Y%m%d")}
        )
        payload = response.json()
        for key in ("BookingDates", "PartialBookingDates"):
            for value in payload.get(key) or []:
                booked.add(date.fromisoformat(value))
    return {day for day in booked if start <= day <= end}


def available_dates(booked: set[date], start: date, end: date) -> list[date]:
    """The complement of `booked` across the horizon."""
    span = (end - start).days + 1
    return [
        day
        for offset in range(span)
        if (day := start + timedelta(days=offset)) not in booked
    ]


def horizon_end(start: date, months: int = BOOKING_HORIZON_MONTHS) -> date:
    """The last bookable date: `months` ahead of `start`, clamped to a real day."""
    first = _add_months(start, months)
    last_day = _end_of_month(first).day
    return first.replace(day=min(start.day, last_day))
