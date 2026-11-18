"""Portal dashboard overview (royal_touche.api.portal_dashboard): shape, figures, roles, dates."""

from datetime import datetime

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche import reports
from royal_touche.api import portal_dashboard as api
from royal_touche.checks import stock_summary
from royal_touche.dates import IST
from royal_touche.errors import RTValidation
from royal_touche.movements import record_movement
from royal_touche.report_logic import daily_status
from royal_touche.rolls import register_roll
from royal_touche.tests.factories import as_user, base_roll, make_material, make_user, standard_locations, today_ist

FIGURES = ["opening", "received", "consumed", "returned_to_vendor", "sold", "adjusted", "closing", "out_at_close"]
STATUSES = ("IN_STOCK", "ISSUED", "CONSUMED", "RETURNED_TO_VENDOR", "SOLD")


def now_iso() -> str:
    return datetime.now(IST).isoformat(timespec="seconds")


def move(roll: str, movement_type: str, **extra) -> dict:
    data = {"movement_type": movement_type, "roll": roll, "transaction_date": now_iso(), "recorded_at": now_iso()}
    data.update(extra)
    return record_movement(data)


def period(frm, to) -> dict:
    return {"from": frm, "to": to}


class TestPortalDashboard(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        loc = standard_locations()
        cls.day = today_ist()
        cls.material = make_material(name="Portal dashboard paper")
        cls.roll = register_roll(base_roll(location=loc["GODOWN-A-1"], weight=150, material=cls.material))["name"]
        move(cls.roll, "OUT", location=loc["RUNNING-1"], issued_to="Line 9")
        move(cls.roll, "RETURN", returned_weight=80)
        cls.supervisor = make_user("Godown Supervisor")
        cls.superadmin = make_user("RT Super Admin")
        cls.refused = [make_user("Godown Operator"), make_user("RT Admin"), make_user("Accounts User")]

    def setUp(self):
        frappe.set_user(self.supervisor)

    def tearDown(self):
        frappe.set_user("Administrator")

    def assert_invalid(self, args, message):
        with self.assertRaises(RTValidation) as caught:
            api.overview(**args)
        self.assertEqual(str(caught.exception), message)
        self.assertEqual(caught.exception.http_status_code, 400)

    def test_overview_shape(self):
        got = api.overview(**period(self.day, self.day))
        self.assertEqual(list(got), ["kpis", "period", "stock_on_hand_top", "activity_7d"])
        kpis = got["kpis"]
        self.assertEqual(
            list(kpis),
            [
                "rolls_total",
                "rolls_by_status",
                "on_hand_kg",
                "out_on_floor_kg",
                "lots_total",
                "vendors_total",
                "locations_total",
                "materials_total",
                "moved_today",
            ],
        )
        for status in STATUSES:
            self.assertIn(status, kpis["rolls_by_status"])
        self.assertEqual(list(got["period"]), ["from", "to", "totals", "top_consumed", "top_out_on_floor"])
        self.assertEqual(list(got["period"]["totals"]), FIGURES)
        self.assertEqual(len(got["activity_7d"]), 7)
        self.assertEqual(got["activity_7d"][-1]["date"], self.day)

    def test_overview_matches_report_helpers(self):
        got = api.overview(**period(self.day, self.day))
        ledger, rolls, _, _ = reports.load()
        expected_period = reports.consumption_summary(self.day, self.day, "material")
        self.assertEqual(got["period"]["totals"], expected_period["totals"])
        self.assertEqual(got["period"]["from"], self.day)
        self.assertEqual(got["period"]["to"], self.day)
        self.assertEqual(got["kpis"]["moved_today"], daily_status.count(ledger, rolls, self.day))
        self.assertGreaterEqual(got["kpis"]["rolls_total"], 1)
        self.assertGreaterEqual(got["kpis"]["rolls_by_status"]["IN_STOCK"], 1)
        self.assertEqual(got["kpis"]["on_hand_kg"], 80.0)

        stock = {r["material"]: r for r in stock_summary()}
        for row in got["stock_on_hand_top"]:
            self.assertEqual(row["on_hand_kg"], stock[row["material"]]["on_hand_kg"])
            self.assertEqual(row["rolls_in_stock"], stock[row["material"]]["rolls_in_stock"])

        top = got["period"]["top_consumed"]
        self.assertTrue(any(r["material_code"] == self.material and r["kg"] == 70 for r in top))

    def test_period_is_checked(self):
        self.assert_invalid({}, "From date is required, To date is required")
        self.assert_invalid({"to": self.day}, "From date is required")
        self.assert_invalid(period("2026-10-31", "2026-10-01"), "From must not be after to")
        self.assert_invalid(period("08-10-2026", self.day), "From must be YYYY-MM-DD")

    def test_only_supervisors_and_super_admins(self):
        args = period(self.day, self.day)
        for user in self.refused:
            with as_user(user), self.assertRaises(frappe.PermissionError, msg=user):
                api.overview(**args)
        for user in (self.supervisor, self.superadmin, "Administrator"):
            with as_user(user):
                api.overview(**args)

    def test_role_is_checked_before_the_query(self):
        with as_user(self.refused[0]), self.assertRaises(frappe.PermissionError):
            api.overview()
