from datetime import date, datetime

from frappe.tests import IntegrationTestCase

from royal_touche.dates import IST, check_operator_date, ist_day
from royal_touche.errors import RTValidation


def ist(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=IST)


class TestDates(IntegrationTestCase):
    def test_utc_evening_is_next_ist_day(self):
        self.assertEqual(ist_day("2026-11-02T19:00:00Z"), date(2026, 11, 3))

    def test_naive_datetimes_are_read_as_ist(self):
        self.assertEqual(ist_day("2026-11-03 00:10:00"), date(2026, 11, 3))

    def test_yesterday_relative_to_recorded_at_is_allowed(self):
        check_operator_date("2026-11-02T23:30:00+05:30", "2026-11-03T00:10:00+05:30", now=ist("2026-11-03 09:00"))

    def test_same_day_is_allowed(self):
        check_operator_date("2026-11-03T08:00:00+05:30", "2026-11-03T08:05:00+05:30", now=ist("2026-11-03 09:00"))

    def test_two_days_back_is_rejected(self):
        with self.assertRaisesRegex(RTValidation, "The date must be today or yesterday"):
            check_operator_date("2026-11-01T10:00:00+05:30", "2026-11-03T10:00:00+05:30", now=ist("2026-11-03 11:00"))

    def test_future_is_rejected_against_server_today(self):
        with self.assertRaisesRegex(RTValidation, "The date cannot be in the future"):
            check_operator_date("2026-11-04T10:00:00+05:30", "2026-11-04T10:00:00+05:30", now=ist("2026-11-03 23:00"))

    def test_without_recorded_at_only_the_future_rule_applies(self):
        check_operator_date("2026-10-01T10:00:00+05:30", None, now=ist("2026-11-03 11:00"))
