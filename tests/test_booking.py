"""Booking-window arithmetic.

The calendar endpoint keys its window off the *month* of the anchor date and
spans that month plus one either side, ignoring the day. Getting the stepping
wrong silently loses a month of availability, which is invisible in the output
— it just looks like nothing is free — so it is worth pinning down precisely.
"""

from datetime import date

from hundeskove import booking


class TestHorizonEnd:
    def test_three_months_ahead(self):
        assert booking.horizon_end(date(2026, 9, 11), 3) == date(2026, 12, 11)

    def test_clamps_to_a_real_day_at_month_end(self):
        """31 Nov does not exist; the horizon has to land on the 28th."""
        assert booking.horizon_end(date(2026, 11, 30), 3) == date(2027, 2, 28)

    def test_crosses_the_year_boundary(self):
        assert booking.horizon_end(date(2026, 11, 15), 3) == date(2027, 2, 15)


class TestMonthAnchors:
    def test_three_month_horizon_needs_two_anchors(self):
        """One anchor covers its month plus one either side — not enough."""
        anchors = booking.month_anchors(date(2026, 9, 11), date(2026, 12, 11))
        assert anchors == [date(2026, 9, 1), date(2026, 11, 1)]

    def test_anchors_always_start_on_the_first(self):
        for anchor in booking.month_anchors(date(2026, 9, 30), date(2027, 3, 1)):
            assert anchor.day == 1

    def test_windows_cover_the_whole_horizon_without_a_gap(self):
        """Every date in the horizon must fall inside some anchor's window."""
        start, end = date(2026, 9, 11), booking.horizon_end(date(2026, 9, 11), 12)
        covered = set()
        for anchor in booking.month_anchors(start, end):
            first = booking._add_months(anchor, -1)
            last = booking._end_of_month(booking._add_months(anchor, 1))
            day = first
            while day <= last:
                covered.add(day)
                day = date.fromordinal(day.toordinal() + 1)
        day = start
        while day <= end:
            assert day in covered, f"{day} falls in no anchor window"
            day = date.fromordinal(day.toordinal() + 1)

    def test_a_tighter_step_only_adds_overlap(self):
        """step=1 must cover at least as much as step=2, never less."""
        start, end = date(2026, 9, 11), date(2026, 12, 11)
        assert set(booking.month_anchors(start, end, 2)) <= set(
            booking.month_anchors(start, end, 1)
        )


class TestAvailableDates:
    def test_complement_of_the_booked_set(self):
        start, end = date(2026, 9, 1), date(2026, 9, 5)
        booked = {date(2026, 9, 2), date(2026, 9, 4)}
        assert booking.available_dates(booked, start, end) == [
            date(2026, 9, 1),
            date(2026, 9, 3),
            date(2026, 9, 5),
        ]

    def test_nothing_booked_means_every_night(self):
        start, end = date(2026, 9, 1), date(2026, 9, 3)
        assert len(booking.available_dates(set(), start, end)) == 3

    def test_bookings_outside_the_horizon_are_ignored(self):
        start, end = date(2026, 9, 1), date(2026, 9, 2)
        booked = {date(2026, 10, 1)}
        assert len(booking.available_dates(booked, start, end)) == 2
