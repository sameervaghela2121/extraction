"""One delta pull for every record kind the tablet keeps: (modified, name) keyset paging."""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from royal_touche.errors import RTValidation
from royal_touche.pull import KINDS, changes
from royal_touche.rolls import delete_roll, register_roll
from royal_touche.tests.factories import (
    as_user, base_roll, make_buyer, make_location, make_material, make_remark, make_user, make_vendor, standard_locations,
)
from royal_touche.tests.test_movements import move


def everything(kind: str, after=None, after_name=None, limit=200) -> list[dict]:
    """Walk every page, as the tablet does."""
    out = []
    for _ in range(10_000):  # a paging bug repeats a page forever; fail instead of hanging
        page = changes(kind, after, after_name, limit)
        out += page["items"]
        if not page["next"]:
            return out
        after, after_name = page["next"]["after"], page["next"]["after_name"]
    raise AssertionError(f"{kind}: paging never ended")


class TestPull(IntegrationTestCase):
    def setUp(self):
        self.since = str(add_to_date(now_datetime(), seconds=-1))

    def names(self, kind):
        return [r["name"] for r in everything(kind, self.since)]

    def test_kinds(self):
        self.assertEqual(KINDS, ("materials", "vendors", "locations", "remarks", "buyers", "lots", "rolls", "movements"))
        with self.assertRaisesRegex(RTValidation, "Unknown kind: stuff"):
            changes("stuff", None, None)

    def test_each_master_kind_returns_what_changed_since(self):
        made = {"materials": make_material(), "vendors": make_vendor(papers=[{"paper_code": "P1", "rt_code": "868"}]),
                "locations": make_location(), "remarks": make_remark(), "buyers": make_buyer()}
        for kind, name in made.items():
            self.assertIn(name, self.names(kind), kind)
            later = str(add_to_date(now_datetime(), seconds=5))
            self.assertNotIn(name, [r["name"] for r in everything(kind, later)], kind)

    def test_shapes(self):
        v = make_vendor(code="SHAPE-V", papers=[{"paper_code": "P1", "rt_code": "868", "delta_code": "D1"}])
        row = next(r for r in everything("vendors", self.since) if r["name"] == v)
        self.assertEqual((row["vendor_code"], row["disabled"], row["papers"][0]["rt_code"]), ("SHAPE-V", 0, "868"))
        loc = make_location("SHAPE-LOC", "Shape rack", "Godown S", 70)
        row = next(r for r in everything("locations", self.since) if r["name"] == loc)
        self.assertEqual((row["location_code"], row["warehouse_name"], row["godown"], row["sort_order"]),
                         ("SHAPE-LOC", "Shape rack", "Godown S", 70))
        m = make_material("SHAPE-MAT")
        row = next(r for r in everything("materials", self.since) if r["name"] == m)
        self.assertEqual((row["material_code"], row["disabled"]), ("SHAPE-MAT", 0))

    def test_rolls_and_movements(self):
        loc = standard_locations()
        roll = register_roll(base_roll(location=loc["GODOWN-A-1"]))
        move(roll["name"], "OUT", location=loc["RUNNING-1"])
        row = next(r for r in everything("rolls", self.since) if r["name"] == roll["name"])
        self.assertEqual((row["status"], row["roll_number"], row["lot_document_type"]), ("ISSUED", roll["roll_number"], "challan"))
        self.assertTrue(row["lot_document_no"])
        mvs = [r for r in everything("movements", self.since) if r["roll"] == roll["name"]]
        self.assertEqual([m["movement_type"] for m in mvs], ["IN", "OUT"])
        self.assertEqual(mvs[1]["roll_number"], roll["roll_number"])

    def test_deleted_and_disabled_come_back_flagged(self):
        roll = register_roll(base_roll())["name"]
        delete_roll(roll)
        self.assertTrue(next(r for r in everything("rolls", self.since) if r["name"] == roll)["deleted"])
        remark = make_remark()
        frappe.db.set_value("RT Remark", remark, "disabled", 1)
        self.assertEqual(next(r for r in everything("remarks", self.since) if r["name"] == remark)["disabled"], 1)

    def test_rows_sharing_one_modified_cross_a_page_boundary_once(self):
        a, b, c = make_remark(), make_remark(), make_remark()
        same = add_to_date(now_datetime(), seconds=2)
        for name in (a, b, c):
            frappe.db.set_value("RT Remark", name, "modified", same, update_modified=False)
        got = [r["name"] for r in everything("remarks", self.since, limit=1) if r["name"] in (a, b, c)]
        self.assertEqual(sorted(got), sorted([a, b, c]))
        self.assertEqual(len(got), 3)

    def test_master_kinds_leave_out_records_that_are_not_ours(self):
        plain_item = frappe.get_doc({"doctype": "Item", "item_code": frappe.generate_hash(length=8), "item_group": "Services",
                                     "stock_uom": "Nos", "is_stock_item": 0}).insert().name
        self.assertNotIn(plain_item, self.names("materials"))
        group = frappe.db.get_value("Warehouse", {"is_group": 1, "company": "Royale Touche"})
        self.assertNotIn(group, self.names("locations"))
        from royal_touche.setup.install import UNASSIGNED_WAREHOUSE
        frappe.db.set_value("Warehouse", UNASSIGNED_WAREHOUSE, "modified", now_datetime())
        self.assertNotIn(UNASSIGNED_WAREHOUSE, self.names("locations"))

    def test_limit_is_capped(self):
        for _ in range(3):
            make_remark()
        self.assertLessEqual(len(changes("remarks", None, None, 10_000)["items"]), 500)

    def test_movements_never_show_a_price_to_godown_roles_through_the_api(self):
        from royal_touche.api import pull as pull_api

        roll = register_roll(base_roll())["name"]
        move(roll, "SELL", rate_per_roll=3000)
        operator = make_user("Godown Operator")
        from unittest.mock import patch

        with as_user(operator), patch("royal_touche.api.pull.HOLD_SECONDS", 0):
            rows = pull_api.changes(kind="movements", after=self.since)["items"]
        sale = next(r for r in rows if r["roll"] == roll and r["movement_type"] == "SELL")
        self.assertNotIn("rate_per_roll", sale)

    def test_outsiders_cannot_pull(self):
        from royal_touche.api import pull as pull_api

        with as_user(make_user("Accounts User")), self.assertRaises(frappe.PermissionError):
            pull_api.changes(kind="remarks")


class TestPullForTheApp(IntegrationTestCase):
    """The app sends back what it received: ISO times in UTC (…Z), any fraction."""

    def test_after_accepts_iso_utc_with_any_fraction(self):
        remark = make_remark()
        modified = frappe.db.get_value("RT Remark", remark, "modified")
        from royal_touche.dates import IST
        from datetime import timezone

        utc = modified.replace(tzinfo=IST).astimezone(timezone.utc)
        just_before = (utc - frappe.utils.datetime.timedelta(milliseconds=1))
        for text in (just_before.strftime("%Y-%m-%dT%H:%M:%S.%fZ"), just_before.strftime("%Y-%m-%dT%H:%M:%S.") +
                     f"{just_before.microsecond // 1000:03d}Z"):
            self.assertIn(remark, [r["name"] for r in everything("remarks", text)], text)
        just_after = (utc + frappe.utils.datetime.timedelta(milliseconds=1)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        self.assertNotIn(remark, [r["name"] for r in everything("remarks", just_after)], "read as UTC, not local")
        self.assertEqual(len(changes("remarks", "1970-01-01T00:00:00.000Z", None, 1)["items"]), 1)

    def test_rolls_carry_received_date_and_creation(self):
        roll = register_roll(base_roll(date="2026-11-02"))
        row = next(r for r in everything("rolls", "1970-01-01T00:00:00.000Z") if r["name"] == roll["name"])
        self.assertEqual(str(row["received_date"])[:10], "2026-11-02")
        self.assertTrue(row["creation"])

    def test_the_newest_seconds_are_held_back_so_a_slower_write_is_never_passed(self):
        """A write still in progress commits with an older modified time than a quicker one. If
        the tablet's checkpoint passed it, the tablet would never get it."""
        remark = make_remark()
        args = ("remarks", "1970-01-01T00:00:00.000Z", None, 500)
        self.assertNotIn(remark, [r["name"] for r in changes(*args, hold_seconds=5)["items"]])
        frappe.db.set_value("RT Remark", remark, "modified", add_to_date(now_datetime(), seconds=-6), update_modified=False)
        self.assertIn(remark, [r["name"] for r in changes(*args, hold_seconds=5)["items"]])

    def test_the_api_holds_back(self):
        from unittest.mock import patch

        from royal_touche.api import pull as pull_api

        with patch("royal_touche.pull.changes", return_value={"items": [], "next": None}) as real:
            pull_api.changes(kind="remarks")
        self.assertEqual(real.call_args.kwargs["hold_seconds"], 5)
