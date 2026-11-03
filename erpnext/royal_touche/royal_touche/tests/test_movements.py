from datetime import datetime

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.dates import IST
from royal_touche.errors import RTConflict, RTValidation
from royal_touche.movements import record_movement
from royal_touche.rolls import register_roll
from royal_touche.tests.factories import base_roll, batch_qty, make_buyer, standard_locations


def now_iso() -> str:
    return datetime.now(IST).isoformat(timespec="seconds")


def move(roll: str, movement_type: str, **extra) -> dict:
    data = {"movement_type": movement_type, "roll": roll, "transaction_date": now_iso(), "recorded_at": now_iso()}
    data.update(extra)
    return record_movement(data)


class TestMovements(IntegrationTestCase):
    def setUp(self):
        self.loc = standard_locations()
        self.home, self.running = self.loc["GODOWN-A-1"], self.loc["RUNNING-1"]
        self.roll = register_roll(base_roll(location=self.home, weight=150))["name"]

    def out(self, roll=None, **extra):
        return move(roll or self.roll, "OUT", location=self.running, **extra)

    # OUT
    def test_out_moves_whole_roll_without_weight_change(self):
        res = self.out()
        self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"]), ("ISSUED", 150))
        self.assertEqual(res["roll"]["location"], self.running)
        self.assertEqual((res["movement"]["weight"], res["movement"]["from_location"]), (150, self.home))
        self.assertEqual((batch_qty(self.roll, self.home), batch_qty(self.roll, self.running)), (0, 150))

    def test_out_needs_a_location(self):
        with self.assertRaisesRegex(RTValidation, "Where is the roll going\\? location is required"):
            move(self.roll, "OUT")

    def test_out_twice_conflicts(self):
        self.out()
        with self.assertRaisesRegex(RTConflict, "This roll is already out — record its return first"):
            self.out()

    # RETURN
    def test_return_80_of_150_goes_home(self):
        self.out()
        res = move(self.roll, "RETURN", returned_weight=80)
        roll = res["roll"]
        self.assertEqual((roll["status"], roll["remaining_weight"], roll["location"]), ("IN_STOCK", 80, self.home))
        self.assertEqual((res["movement"]["weight"], res["movement"]["used_weight"]), (80, 70))
        self.assertEqual((batch_qty(self.roll, self.home), batch_qty(self.roll, self.running)), (80, 0))

    def test_return_zero_means_consumed_with_no_location(self):
        self.out()
        res = move(self.roll, "RETURN", returned_weight=0)
        self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"], res["roll"]["location"]), ("CONSUMED", 0, None))
        self.assertEqual(res["movement"]["used_weight"], 150)
        self.assertEqual(batch_qty(self.roll), 0)

    def test_return_heavier_is_rejected(self):
        self.out()
        with self.assertRaisesRegex(RTValidation, "This roll went out with 150 kg — it cannot come back heavier at 160"):
            move(self.roll, "RETURN", returned_weight=160)

    def test_return_needs_returned_weight(self):
        self.out()
        with self.assertRaisesRegex(RTValidation, "RETURN requires returned_weight — what the roll weighs coming back"):
            move(self.roll, "RETURN")

    def test_return_when_not_out_conflicts(self):
        with self.assertRaisesRegex(RTConflict, "This roll is not currently out, so it cannot be returned"):
            move(self.roll, "RETURN", returned_weight=10)

    # CONSUME
    def test_consume_issued_roll(self):
        self.out()
        res = move(self.roll, "CONSUME")
        self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"], res["roll"]["location"]), ("CONSUMED", 0, None))
        self.assertEqual(res["movement"]["used_weight"], 150)
        self.assertEqual(batch_qty(self.roll), 0)

    def test_consume_finished_roll_is_a_noop(self):
        self.out()
        move(self.roll, "CONSUME")
        res = move(self.roll, "CONSUME")
        self.assertEqual((res["movement"]["weight"], res["movement"]["stock_docname"]), (0, None))
        self.assertEqual(res["roll"]["status"], "CONSUMED")

    # RETURN_TO_VENDOR
    def test_return_to_vendor_from_stock(self):
        res = move(self.roll, "RETURN_TO_VENDOR", remarks="Colour off")
        roll = res["roll"]
        self.assertEqual((roll["status"], roll["remaining_weight"], roll["location"]), ("RETURNED_TO_VENDOR", 0, None))
        doc = frappe.get_doc(res["movement"]["stock_doctype"], res["movement"]["stock_docname"])
        self.assertEqual((doc.doctype, doc.is_return, abs(doc.items[0].qty)), ("Purchase Receipt", 1, 150))
        self.assertEqual(batch_qty(self.roll), 0)

    def test_return_to_vendor_when_out_conflicts(self):
        self.out()
        with self.assertRaisesRegex(RTConflict, "This roll is already out — record its return first"):
            move(self.roll, "RETURN_TO_VENDOR")

    def test_return_to_vendor_twice_conflicts(self):
        move(self.roll, "RETURN_TO_VENDOR")
        with self.assertRaisesRegex(RTConflict, "This roll has already been returned to the vendor"):
            move(self.roll, "RETURN_TO_VENDOR")

    # SELL
    def test_sell_needs_a_buyer(self):
        with self.assertRaisesRegex(RTValidation, "Pick the buyer"):
            move(self.roll, "SELL")

    def test_sell_makes_a_delivery_note(self):
        buyer = make_buyer()
        res = move(self.roll, "SELL", buyer=buyer, vehicle_no="GJ01AB1234")
        self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"], res["roll"]["location"]), ("SOLD", 0, None))
        dn = frappe.get_doc(res["movement"]["stock_doctype"], res["movement"]["stock_docname"])
        self.assertEqual((dn.doctype, dn.customer, dn.items[0].qty), ("Delivery Note", buyer, 150))
        self.assertIsNone(res["movement"]["savio_bill_no"])
        self.assertEqual(batch_qty(self.roll), 0)

    def test_sell_rate_per_roll_is_the_line_amount(self):
        res = move(self.roll, "SELL", buyer=make_buyer(), rate_per_roll=3000, savio_bill_no="SV-1")
        dn = frappe.get_doc("Delivery Note", res["movement"]["stock_docname"])
        self.assertAlmostEqual(dn.items[0].amount, 3000, places=2)
        self.assertAlmostEqual(dn.items[0].rate, 20, places=4)

    def test_sell_while_out_conflicts(self):
        self.out()
        with self.assertRaisesRegex(RTConflict, "This roll is out on production — receive it back before selling it"):
            move(self.roll, "SELL", buyer=make_buyer())

    def test_sold_roll_rejects_out(self):
        move(self.roll, "SELL", buyer=make_buyer())
        with self.assertRaisesRegex(RTConflict, "This roll has already been sold"):
            self.out()

    # IN and ADJUSTMENT
    def test_in_adds_weight_up_to_the_original(self):
        self.out()
        move(self.roll, "RETURN", returned_weight=100)
        res = move(self.roll, "IN", weight=50)
        self.assertEqual(res["roll"]["remaining_weight"], 150)
        self.assertEqual(batch_qty(self.roll, self.home), 150)
        with self.assertRaisesRegex(RTValidation, "This roll only ever held 150 kg — cannot add more than that"):
            move(self.roll, "IN", weight=1)

    def test_adjustment_to_zero_consumes(self):
        res = move(self.roll, "ADJUSTMENT", new_weight=0, remarks="Counted empty")
        self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"], res["roll"]["location"]), ("CONSUMED", 0, None))
        self.assertEqual(batch_qty(self.roll), 0)

    def test_adjustment_rules(self):
        with self.assertRaisesRegex(RTValidation, "ADJUSTMENT requires remarks"):
            move(self.roll, "ADJUSTMENT", new_weight=120)
        with self.assertRaisesRegex(RTValidation, "This roll only ever held 150 kg — the counted amount cannot be higher"):
            move(self.roll, "ADJUSTMENT", new_weight=151, remarks="x")
        res = move(self.roll, "ADJUSTMENT", new_weight=120, remarks="Recount")
        self.assertEqual((res["roll"]["remaining_weight"], batch_qty(self.roll, self.home)), (120, 120))

    # Shared rules
    def test_operator_date_rule_applies(self):
        with self.assertRaisesRegex(RTValidation, "The date must be today or yesterday"):
            move(self.roll, "OUT", location=self.running, transaction_date="2026-01-01T10:00:00+05:30")

    def test_same_client_id_returns_the_first_movement(self):
        cid = frappe.generate_hash(length=16)
        a = self.out(client_id=cid)
        b = self.out(client_id=cid)
        self.assertEqual(a["movement"]["name"], b["movement"]["name"])
        self.assertEqual(frappe.db.count("Roll Movement", {"client_id": cid}), 1)

    def test_more_than_four_photos_rejected(self):
        with self.assertRaisesRegex(RTValidation, "At most 4 photos per movement"):
            self.out(photos=["/private/files/a.jpg"] * 5)
