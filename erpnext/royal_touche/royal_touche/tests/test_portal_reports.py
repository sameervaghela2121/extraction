"""The portal's report endpoints (royal_touche.api.portal_reports): the old server's JSON, its
validation messages, its role rule and its CSV files (backend/src/routes/reports.routes.ts)."""

from datetime import datetime

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche import reports
from royal_touche.api import portal_reports as api
from royal_touche.dates import IST
from royal_touche.errors import RTValidation
from royal_touche.movements import record_movement
from royal_touche.report_logic import daily_status
from royal_touche.rolls import register_roll
from royal_touche.tests.factories import as_user, base_roll, make_material, make_user, standard_locations, today_ist
from royal_touche.tests.test_report_logic import NODE_COLUMNS

BOM = "﻿"
FIGURES = ["opening", "received", "consumed", "returned_to_vendor", "sold", "adjusted", "closing", "out_at_close"]
FIGURE_HEADER = ("Opening (kg),Received (kg),Consumed (kg),Returned to vendor (kg),Sold (kg),Adjusted (kg),"
                 "Closing (kg),Out on floor at close (kg)")


def now_iso() -> str:
    return datetime.now(IST).isoformat(timespec="seconds")


def move(roll: str, movement_type: str, **extra) -> dict:
    data = {"movement_type": movement_type, "roll": roll, "transaction_date": now_iso(), "recorded_at": now_iso()}
    data.update(extra)
    return record_movement(data)


def period(frm, to, group=None) -> dict:
    args = {"from": frm, "to": to}
    if group is not None:
        args["group"] = group
    return args


class TestPortalReports(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        loc = standard_locations()
        cls.day = today_ist()
        cls.material = make_material(name="Portal report paper")
        # Registered today at 150 kg, out to the floor, back at 80: 70 kg consumed.
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

    # ---- Consumption JSON ------------------------------------------------------------------

    def test_consumption_is_the_old_servers_summary(self):
        for group in ("material", "design"):
            got = api.consumption(**period(self.day, self.day, group))
            self.assertEqual(got, reports.consumption_summary(self.day, self.day, group), group)
            self.assertEqual(list(got), ["from", "to", "group", "rows", "totals"])
            self.assertEqual((got["from"], got["to"], got["group"]), (self.day, self.day, group))
            self.assertEqual(list(got["totals"]), FIGURES)

    def test_consumption_figures_for_the_scenario(self):
        got = api.consumption(**period(self.day, self.day, "material"))
        row = next(r for r in got["rows"] if r["material_code"] == self.material)
        self.assertEqual(row["material"], "Portal report paper")
        self.assertEqual([row[f] for f in FIGURES], [0, 150, 70, 0, 0, 0, 80, 0])
        self.assertEqual(list(row), ["material_code", "material", *FIGURES])

    def test_group_defaults_to_material(self):
        got = api.consumption(**period(self.day, self.day))
        self.assertEqual(got["group"], "material")
        self.assertEqual(got, reports.consumption_summary(self.day, self.day, "material"))

    # ---- Validation: the zod schemas' messages ---------------------------------------------

    def assert_invalid(self, fn, args, message):
        with self.assertRaises(RTValidation) as caught:
            fn(**args)
        self.assertEqual(str(caught.exception), message)
        self.assertEqual(caught.exception.http_status_code, 400)

    # Each message as the Node schema gave it (zod 3.25 run on these very inputs).
    PERIOD_CASES = [
        ({"to": "2026-10-31"}, "From date is required"),
        ({}, "From date is required, To date is required"),
        (period("2026-13-01", "2026-10-31"), "From must be YYYY-MM-DD, From must not be after to"),
        (period("20261001", "2026-10-31"), "From must be YYYY-MM-DD, From must not be after to"),
        (period("2026-02-29", "2026-10-31"), "From must be YYYY-MM-DD"),
        (period("2026-10-01", ""), "To must be YYYY-MM-DD, From must not be after to"),
        (period("2026-10-31", "2026-10-01"), "From must not be after to"),
        (period("2026-11-31", "2026-10-01"), "From must be YYYY-MM-DD, From must not be after to"),
        (period("2026-10-01", "2026-10-31", "vendor"),
         "group: Invalid enum value. Expected 'material' | 'design', received 'vendor'"),
        ({"group": "vendor"}, "From date is required, To date is required, "
                              "group: Invalid enum value. Expected 'material' | 'design', received 'vendor'"),
        (period("2026-10-01", "2026-10-31", ""), "group: Invalid enum value. Expected 'material' | 'design', received ''"),
        (period("x", "y", "vendor"), "From must be YYYY-MM-DD, To must be YYYY-MM-DD, "
                                     "group: Invalid enum value. Expected 'material' | 'design', received 'vendor'"),
        (period(["a", "b"], "2026-10-31"), "from: Expected string, received array"),
    ]

    def test_consumption_period_is_checked(self):
        for fn in (api.consumption, api.consumption_summary_csv, api.consumption_detail_csv):
            for args, message in self.PERIOD_CASES:
                self.assert_invalid(fn, args, message)

    def test_daily_date_is_checked(self):
        for fn in (api.daily_rolls_count, api.daily_rolls):
            self.assert_invalid(fn, {}, "Date is required")
            self.assert_invalid(fn, {"date": "08-10-2026"}, "Date must be YYYY-MM-DD")
            self.assert_invalid(fn, {"date": ""}, "Date must be YYYY-MM-DD")

    def test_a_single_day_period_is_fine(self):
        api.consumption(**period("2026-10-08", "2026-10-08"))

    # ---- Roles: requireRole("godown_supervisor"); super_admin always passes --------------------

    def every_call(self):
        day = {"date": self.day}
        span = period(self.day, self.day, "material")
        return [(api.daily_rolls_count, day), (api.daily_rolls, day), (api.consumption, span),
                (api.consumption_summary_csv, span), (api.consumption_detail_csv, span)]

    def test_only_supervisors_and_super_admins(self):
        for fn, args in self.every_call():
            for user in self.refused:  # RT Admin had no report access in Node either
                with as_user(user), self.assertRaises(frappe.PermissionError, msg=f"{fn.__name__} {user}"):
                    fn(**args)
            for user in (self.supervisor, self.superadmin, "Administrator"):
                with as_user(user):
                    fn(**args)

    def test_role_is_checked_before_the_query(self):
        with as_user(self.refused[0]), self.assertRaises(frappe.PermissionError):
            api.consumption()

    # ---- Daily rolls --------------------------------------------------------------------------

    def test_daily_count_is_the_old_servers_shape(self):
        ledger, rolls, _, _ = reports.load()
        got = api.daily_rolls_count(date=self.day)
        self.assertEqual(got, {"count": daily_status.count(ledger, rolls, self.day)})
        self.assertGreaterEqual(got["count"], 1)
        self.assertEqual(api.daily_rolls_count(date="2000-01-01"), {"count": 0})

    def test_daily_csv(self):
        api.daily_rolls(date=self.day)
        self.assert_csv(f"daily-roll-report-{self.day}.csv", reports.daily_csv(self.day), ",".join(NODE_COLUMNS))
        roll_number = frappe.db.get_value("Batch", self.roll, "rt_roll_number")
        self.assertIn(roll_number, frappe.response["filecontent"])

    # ---- Consumption CSVs ---------------------------------------------------------------------

    def test_summary_csv_by_material(self):
        api.consumption_summary_csv(**period(self.day, self.day, "material"))
        self.assert_csv(f"consumption-summary-{self.day}-to-{self.day}.csv",
                        reports.consumption_summary_csv(self.day, self.day, "material"),
                        f"Material code,Material,{FIGURE_HEADER}")
        self.assertIn(f"{self.material},Portal report paper,0,150,70,0,0,0,80,0\r\n", frappe.response["filecontent"])

    def test_summary_csv_without_group_is_by_material(self):
        api.consumption_summary_csv(**period(self.day, self.day))
        self.assertEqual(frappe.response["filename"], f"consumption-summary-{self.day}-to-{self.day}.csv")

    def test_summary_csv_by_design(self):
        api.consumption_summary_csv(**period(self.day, self.day, "design"))
        self.assert_csv(f"consumption-by-design-{self.day}-to-{self.day}.csv",
                        reports.consumption_summary_csv(self.day, self.day, "design"),
                        f"RT code,Delta code,Vendor,Material,{FIGURE_HEADER}")

    def test_detail_csv(self):
        api.consumption_detail_csv(**period(self.day, self.day))
        self.assert_csv(f"consumption-detail-{self.day}-to-{self.day}.csv",
                        reports.consumption_detail_csv(self.day, self.day),
                        "Date,Roll number,Barcode,Material code,Material,RT code,Delta code,Consumed (kg),"
                        "Left on roll (kg),Lot type,Challan / invoice no,Used at,Issued to,Note")
        self.assertIn(",70,80,", frappe.response["filecontent"])
        self.assertIn(",Line 9,", frappe.response["filecontent"])

    def assert_csv(self, filename, expected, header):
        self.assertEqual(frappe.response["type"], "download")
        self.assertEqual(frappe.response["filename"], filename)
        self.assertEqual(frappe.response["content_type"], "text/csv")  # + "; charset=utf-8" by Werkzeug
        content = frappe.response["filecontent"]
        self.assertEqual(content, expected)
        self.assertTrue(content.startswith(BOM + header + "\r\n"), content[:200])
        self.assertTrue(content.endswith("\r\n"))
