import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from royal_touche.errors import RTDuplicate, RTValidation
from royal_touche.rolls import delete_roll, register_roll, set_remark_codes, update_roll
from royal_touche.tests.factories import base_roll, batch_qty, make_buyer, make_remark, standard_locations
from royal_touche.tests.test_movements import move


class TestRollEdit(IntegrationTestCase):
    def setUp(self):
        self.roll = register_roll(base_roll())["name"]

    def test_update_corrects_label_fields(self):
        r = update_roll(self.roll, {"roll_number": "fixed-1", "gsm": 90, "width": 1300})
        self.assertEqual((r["roll_number"], r["gsm"], r["width"]), ("FIXED-1", 90, 1300))

    def test_status_cannot_be_edited(self):
        with self.assertRaisesRegex(RTValidation, "A roll's status follows its movements — issue or consume it instead"):
            update_roll(self.roll, {"status": "SOLD"})

    def test_client_id_cannot_be_changed(self):
        with self.assertRaisesRegex(RTValidation, "client_id is set when the roll is created and cannot be changed"):
            update_roll(self.roll, {"client_id": "x"})

    def test_weights_and_location_cannot_be_edited(self):
        for field in ("remaining_weight", "weight", "location"):
            with self.assertRaises(RTValidation):
                update_roll(self.roll, {field: 1})

    def test_rename_to_a_taken_number(self):
        other = register_roll(base_roll(roll_number="TAKEN-9"))
        with self.assertRaisesRegex(RTDuplicate, "A roll with this number already exists"):
            update_roll(self.roll, {"roll_number": other["roll_number"].lower()})

    def test_set_remark_codes(self):
        a, b = make_remark(), make_remark()
        self.assertEqual(sorted(set_remark_codes(self.roll, [a, b])["remark_codes"]), sorted([a, b]))
        self.assertEqual(set_remark_codes(self.roll, [])["remark_codes"], [])

    def test_unknown_or_too_many_remarks(self):
        with self.assertRaisesRegex(RTValidation, "One or more remarks don't exist"):
            set_remark_codes(self.roll, ["nope"])
        with self.assertRaisesRegex(RTValidation, "Too many remark codes"):
            set_remark_codes(self.roll, [make_remark() for _ in range(21)])


class TestRollDelete(IntegrationTestCase):
    def test_delete_a_roll_with_history(self):
        loc = standard_locations()
        data = base_roll(location=loc["GODOWN-A-1"], roll_number="DEL-1")
        roll = register_roll(data)["name"]
        move(roll, "OUT", location=loc["RUNNING-1"])
        move(roll, "RETURN", returned_weight=100)
        move(roll, "SELL", buyer=make_buyer())
        before = add_to_date(now_datetime(), seconds=-1)

        self.assertEqual(delete_roll(roll), {"name": roll, "deleted": True})

        batch = frappe.get_doc("Batch", roll)
        self.assertEqual((batch.rt_deleted, batch.rt_roll_key, batch.rt_barcode_key), (1, None, None))
        self.assertEqual(batch_qty(roll), 0)
        movements = frappe.get_all("Roll Movement", {"roll": roll}, ["deleted", "stock_doctype", "stock_docname"])
        self.assertTrue(movements and all(m.deleted for m in movements))
        for m in movements:
            if m.stock_docname:
                self.assertEqual(frappe.db.get_value(m.stock_doctype, m.stock_docname, "docstatus"), 2)
        changed = frappe.get_all("Batch", {"modified": [">=", before]}, ["name", "rt_deleted"])
        self.assertIn({"name": roll, "rt_deleted": 1}, [dict(r) for r in changed])
        # The number is free again.
        again = register_roll(base_roll(roll_number="DEL-1"))
        self.assertNotEqual(again["name"], roll)
