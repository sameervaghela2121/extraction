"""Correcting a roll's weight, material and location (royal_touche.roll_corrections).

A roll that has not moved yet was registered wrong: its receipt is replaced and its IN row
corrected in place, with no new history row. A roll that has moved keeps its ledger: its
remaining weight is corrected by an ADJUSTMENT and its stock moved to a new location by a
transfer; its material and arrival weight are locked."""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt

from royal_touche.checks import ledger_mismatches
from royal_touche.errors import RTNotFound, RTValidation
from royal_touche.roll_corrections import correct_roll
from royal_touche.rolls import delete_roll, register_roll
from royal_touche.setup.install import UNASSIGNED_WAREHOUSE
from royal_touche.tests.factories import (
    base_roll,
    batch_qty,
    make_buyer,
    make_location,
    make_material,
    make_user,
    standard_locations,
)
from royal_touche.tests.test_movements import move


def live_movements(roll: str) -> list:
    return frappe.get_all("Roll Movement", {"roll": roll, "deleted": 0},
                          ["name", "movement_type", "weight", "roll_weight_after", "material", "to_location",
                           "stock_doctype", "stock_docname", "stock_documents", "remarks", "owner", "modified"],
                          order_by="creation asc")


class CorrectionCase(IntegrationTestCase):
    def setUp(self):
        self.loc = standard_locations()
        self.home, self.other, self.running = self.loc["GODOWN-A-1"], self.loc["GODOWN-B-1"], self.loc["RUNNING-1"]
        self.user = make_user("RT Admin")
        frappe.set_user(self.user)

    def tearDown(self):
        frappe.set_user("Administrator")

    def assertLedgerAgrees(self, roll):
        self.assertEqual(ledger_mismatches([roll]), [])
        b = frappe.db.get_value("Batch", roll, ["rt_remaining_weight", "rt_location", "rt_status"], as_dict=True)
        if b.rt_status in ("IN_STOCK", "ISSUED"):
            self.assertEqual(batch_qty(roll, b.rt_location or UNASSIGNED_WAREHOUSE), flt(b.rt_remaining_weight))

    def assertRefused(self, roll, changes, message):
        before = frappe.db.get_value("Batch", roll, "*", as_dict=True)
        movements = live_movements(roll)
        with self.assertRaisesRegex(RTValidation, message):
            correct_roll(roll, changes)
        after = frappe.db.get_value("Batch", roll, "*", as_dict=True)
        self.assertEqual(after, before, "a refused correction wrote to the roll")
        self.assertEqual(live_movements(roll), movements, "a refused correction wrote to the history")
        self.assertLedgerAgrees(roll)


class TestUntouchedRoll(CorrectionCase):
    """Nothing has happened to it yet: the registration itself is corrected."""

    def setUp(self):
        super().setUp()
        self.roll = register_roll(base_roll(location=self.home, weight=150, rate_per_roll=3000))["name"]
        self.receipt = frappe.db.get_value("Batch", self.roll, "rt_purchase_receipt")

    def replacement(self):
        receipt = frappe.db.get_value("Batch", self.roll, "rt_purchase_receipt")
        self.assertNotEqual(receipt, self.receipt)
        self.assertEqual(frappe.db.get_value("Purchase Receipt", self.receipt, "docstatus"), 2)
        pr = frappe.get_doc("Purchase Receipt", receipt)
        self.assertEqual(pr.docstatus, 1)
        self.assertEqual(pr.owner, self.user)
        # ERPNext's own trail for a corrected document: an amendment of the cancelled one.
        self.assertEqual((pr.amended_from, pr.name), (self.receipt, f"{self.receipt}-1"))
        return pr

    def test_the_roll_is_read_under_its_row_lock(self):
        """The lock taken against a tablet movement only helps if the roll is read with it: a
        plain read after the lock still sees this transaction's snapshot from before."""
        from unittest.mock import patch

        with patch.object(frappe.db, "sql", wraps=frappe.db.sql) as spy:
            correct_roll(self.roll, {"location": self.other})
        reads = [str(c.args[0]) for c in spy.call_args_list
                 if c.args and "tabBatch" in str(c.args[0]) and str(c.args[0]).lstrip().upper().startswith("SELECT *")]
        self.assertTrue(reads, "the correction never read its roll")
        self.assertIn("FOR UPDATE", reads[0].upper(), reads[0])

    def test_weight_replaces_the_receipt_and_corrects_the_in_row(self):
        r = correct_roll(self.roll, {"weight": 120, "remaining_weight": 120})
        self.assertEqual((r["name"], r["weight"], r["remaining_weight"], r["status"]), (self.roll, 120, 120, "IN_STOCK"))
        pr = self.replacement()
        row = pr.items[0]
        self.assertEqual((row.qty, row.warehouse, row.batch_no), (120, self.home, self.roll))
        # The roll's price stays the roll's price; ERPNext's per-kg rate follows the new weight.
        self.assertAlmostEqual(flt(row.amount), 3000, places=2)
        old = frappe.get_doc("Purchase Receipt", self.receipt)
        self.assertEqual((pr.posting_date, str(pr.posting_time)), (old.posting_date, str(old.posting_time)))
        (mv,) = live_movements(self.roll)
        self.assertEqual((mv.movement_type, mv.weight, mv.roll_weight_after), ("IN", 120, 120))
        self.assertEqual((mv.stock_doctype, mv.stock_docname), ("Purchase Receipt", pr.name))
        self.assertEqual(frappe.parse_json(mv.stock_documents), [["Purchase Receipt", pr.name]])
        self.assertEqual(batch_qty(self.roll, self.home), 120)
        self.assertLedgerAgrees(self.roll)

    def test_the_price_does_not_drift_over_corrections(self):
        """ERPNext keeps a per-kg rate, rounded; rebuilt from the last receipt's amount the roll's
        price would creep a paisa per correction. Each receipt carries the price it arrived at."""
        def amount(roll):
            receipt = frappe.db.get_value("Batch", roll, "rt_purchase_receipt")
            return flt(frappe.get_doc("Purchase Receipt", receipt).items[0].amount, 2)

        roll = register_roll(base_roll(location=self.home, weight=7, rate_per_roll=1000))["name"]
        for weight in (3, 9, 11.3):
            correct_roll(roll, {"weight": weight, "remaining_weight": weight})
            # What a roll registered at this weight for 1000 comes to (ERPNext rounds the rate).
            fresh = register_roll(base_roll(location=self.home, weight=weight, rate_per_roll=1000))["name"]
            self.assertEqual(amount(roll), amount(fresh), f"after correcting to {weight} kg")
            self.assertAlmostEqual(amount(roll), 1000, delta=0.005 * weight)

    def test_a_roll_registered_before_the_price_was_kept_stops_drifting_after_one_correction(self):
        roll = register_roll(base_roll(location=self.home, weight=7, rate_per_roll=1000))["name"]
        (mv,) = live_movements(roll)
        frappe.db.set_value("Roll Movement", mv.name, "rate_per_roll", 0)  # as registered before
        correct_roll(roll, {"weight": 3, "remaining_weight": 3})  # priced from the old receipt: 1000.02
        self.assertEqual(frappe.db.get_value("Roll Movement", mv.name, "rate_per_roll"), 1000.02)
        correct_roll(roll, {"weight": 9, "remaining_weight": 9})
        receipt = frappe.db.get_value("Batch", roll, "rt_purchase_receipt")
        self.assertAlmostEqual(flt(frappe.get_doc("Purchase Receipt", receipt).items[0].amount), 1000.02, delta=0.05)

    def test_material_keeps_the_batch_and_moves_it_to_the_new_item(self):
        material = make_material()
        r = correct_roll(self.roll, {"material": material})
        self.assertEqual((r["name"], r["material"], r["weight"]), (self.roll, material, 150))
        self.assertEqual(frappe.db.get_value("Batch", self.roll, "item"), material)
        pr = self.replacement()
        self.assertEqual((pr.items[0].item_code, pr.items[0].batch_no, pr.items[0].qty), (material, self.roll, 150))
        (mv,) = live_movements(self.roll)
        self.assertEqual(mv.material, material)
        self.assertEqual(batch_qty(self.roll, self.home), 150)
        self.assertLedgerAgrees(self.roll)

    def test_location_receives_it_into_the_new_godown(self):
        r = correct_roll(self.roll, {"location": self.other})
        self.assertEqual(r["location"], self.other)
        pr = self.replacement()
        self.assertEqual(pr.items[0].warehouse, self.other)
        (mv,) = live_movements(self.roll)
        self.assertEqual(mv.to_location, self.other)
        self.assertEqual((batch_qty(self.roll, self.home), batch_qty(self.roll, self.other)), (0, 150))
        self.assertLedgerAgrees(self.roll)

    def test_everything_at_once_in_one_replacement(self):
        material = make_material()
        r = correct_roll(self.roll, {"weight": 140, "remaining_weight": 140, "material": material,
                                     "location": self.other})
        self.assertEqual((r["weight"], r["remaining_weight"], r["material"], r["location"]),
                         (140, 140, material, self.other))
        pr = self.replacement()
        self.assertEqual((pr.items[0].item_code, pr.items[0].qty, pr.items[0].warehouse), (material, 140, self.other))
        self.assertEqual(len(live_movements(self.roll)), 1)
        self.assertEqual(batch_qty(self.roll, self.other), 140)
        self.assertLedgerAgrees(self.roll)

    def test_a_roll_registered_without_a_location_gets_one(self):
        roll = register_roll(base_roll(location=None))["name"]
        correct_roll(roll, {"location": self.other})
        self.assertEqual((batch_qty(roll, UNASSIGNED_WAREHOUSE), batch_qty(roll, self.other)), (0, 150))
        self.assertLedgerAgrees(roll)

    def test_corrected_rows_reach_the_tablet(self):
        """The tablet pulls rolls and movements changed since its last pull, by `modified`."""
        batch_before = frappe.db.get_value("Batch", self.roll, "modified")
        in_before = live_movements(self.roll)[0].modified
        correct_roll(self.roll, {"weight": 110, "remaining_weight": 110})
        self.assertGreater(frappe.db.get_value("Batch", self.roll, "modified"), batch_before)
        self.assertGreater(live_movements(self.roll)[0].modified, in_before)

    def test_same_values_change_nothing(self):
        r = correct_roll(self.roll, {"weight": 150, "remaining_weight": "150", "location": self.home,
                                     "material": frappe.db.get_value("Batch", self.roll, "item")})
        self.assertEqual(r["weight"], 150)
        self.assertEqual(frappe.db.get_value("Batch", self.roll, "rt_purchase_receipt"), self.receipt)
        self.assertEqual(frappe.db.get_value("Purchase Receipt", self.receipt, "docstatus"), 1)

    def test_weight_and_remaining_must_agree(self):
        message = "hasn't moved yet"
        self.assertRefused(self.roll, {"weight": 120, "remaining_weight": 100}, message)
        self.assertRefused(self.roll, {"remaining_weight": 100}, message)
        self.assertRefused(self.roll, {"weight": 100}, message)

    def test_validation(self):
        inactive = make_location()
        frappe.db.set_value("Warehouse", inactive, "disabled", 1)
        plain_item = frappe.get_doc({"doctype": "Item", "item_code": frappe.generate_hash(length=8).upper(),
                                     "item_group": "Raw Material", "has_batch_no": 1}).insert().name
        cases = [
            ({"weight": 0, "remaining_weight": 0}, "Weight must be greater than 0"),
            ({"weight": -5, "remaining_weight": -5}, "Weight must be greater than 0"),
            ({"weight": "abc", "remaining_weight": "abc"}, "Weight must be a number"),
            ({"location": "no-such-place"}, "That location no longer exists — pick another"),
            ({"location": UNASSIGNED_WAREHOUSE}, "That location no longer exists — pick another"),
            ({"location": inactive}, "is inactive — pick a different location"),
            ({"location": None}, "That location no longer exists — pick another"),
            ({"material": "no-such-item"}, "That material no longer exists — pick another"),
            ({"material": plain_item}, "That material no longer exists — pick another"),
            ({"weight": 120, "remaining_weight": 120, "material": "no-such-item"},
             "That material no longer exists — pick another"),
            ({"status": "SOLD"}, "status cannot be corrected here"),
            ({}, "Provide at least one field to update"),
        ]
        for changes, message in cases:
            with self.subTest(changes=changes):
                self.assertRefused(self.roll, changes, message)

    def test_a_failure_part_way_undoes_what_was_written(self):
        """The receipt is cancelled before its replacement is posted; if posting fails, the
        cancellation is undone with everything else."""
        from unittest.mock import patch

        batch = frappe.db.get_value("Batch", self.roll, "*", as_dict=True)
        with patch("royal_touche.roll_corrections.purchase_receipt", side_effect=RTValidation("posting failed")):
            with self.assertRaisesRegex(RTValidation, "posting failed"):
                correct_roll(self.roll, {"weight": 120, "remaining_weight": 120, "material": make_material()})
        self.assertEqual(frappe.db.get_value("Purchase Receipt", self.receipt, "docstatus"), 1)
        self.assertEqual(frappe.db.get_value("Batch", self.roll, "*", as_dict=True), batch)
        self.assertEqual(batch_qty(self.roll, self.home), 150)
        self.assertLedgerAgrees(self.roll)

    def test_an_inactive_material_is_refused(self):
        material = make_material()
        frappe.db.set_value("Item", material, "disabled", 1)
        self.assertRefused(self.roll, {"material": material}, "is inactive")

    def test_the_corrected_roll_moves_on_as_any_other(self):
        material = make_material()
        correct_roll(self.roll, {"weight": 140, "remaining_weight": 140, "material": material,
                                 "location": self.other})
        move(self.roll, "OUT", location=self.running)
        move(self.roll, "RETURN", returned_weight=100)
        self.assertEqual(frappe.db.get_value("Batch", self.roll, "rt_location"), self.other)
        move(self.roll, "RETURN_TO_VENDOR")
        self.assertLedgerAgrees(self.roll)
        self.assertEqual(batch_qty(self.roll), 0)
        out = next(m for m in live_movements(self.roll) if m.movement_type == "OUT")
        self.assertEqual(out.material, material)

    def test_the_corrected_roll_can_be_deleted(self):
        correct_roll(self.roll, {"weight": 140, "remaining_weight": 140, "location": self.other})
        delete_roll(self.roll)
        self.assertEqual(batch_qty(self.roll), 0)
        self.assertEqual(ledger_mismatches([self.roll]), [])

    def test_unknown_or_deleted_roll(self):
        with self.assertRaisesRegex(RTNotFound, "Roll not found"):
            correct_roll("no-such-roll", {"weight": 10, "remaining_weight": 10})
        delete_roll(self.roll)
        with self.assertRaisesRegex(RTNotFound, "Roll not found"):
            correct_roll(self.roll, {"weight": 10, "remaining_weight": 10})


class TestMovedRoll(CorrectionCase):
    """It has a history: the ledger explains every change from here on."""

    def setUp(self):
        super().setUp()
        self.roll = register_roll(base_roll(location=self.home, weight=150))["name"]
        move(self.roll, "OUT", location=self.running)
        move(self.roll, "RETURN", returned_weight=100)  # back home, 100 kg
        self.count = len(live_movements(self.roll))

    def test_remaining_weight_is_an_adjustment(self):
        before = frappe.db.get_value("Batch", self.roll, "modified")
        r = correct_roll(self.roll, {"remaining_weight": 80})
        self.assertEqual((r["remaining_weight"], r["weight"], r["status"]), (80, 150, "IN_STOCK"))
        movements = live_movements(self.roll)
        self.assertEqual(len(movements), self.count + 1)
        adj = movements[-1]
        self.assertEqual((adj.movement_type, adj.weight, adj.roll_weight_after, adj.remarks, adj.owner),
                         ("ADJUSTMENT", 20, 80, "Corrected on the portal", self.user))
        self.assertEqual(batch_qty(self.roll, self.home), 80)
        self.assertGreater(frappe.db.get_value("Batch", self.roll, "modified"), before)
        self.assertLedgerAgrees(self.roll)

    def test_remaining_weight_up_to_the_arrival_weight(self):
        correct_roll(self.roll, {"remaining_weight": 150})
        self.assertEqual(batch_qty(self.roll, self.home), 150)
        self.assertLedgerAgrees(self.roll)

    def test_remaining_zero_finishes_the_roll_as_an_adjustment_does(self):
        r = correct_roll(self.roll, {"remaining_weight": 0})
        self.assertEqual((r["remaining_weight"], r["status"], r["location"]), (0, "CONSUMED", None))
        self.assertEqual(batch_qty(self.roll), 0)
        self.assertLedgerAgrees(self.roll)

    def test_location_is_a_transfer_with_no_history_row(self):
        r = correct_roll(self.roll, {"location": self.other})
        self.assertEqual((r["location"], r["remaining_weight"], r["status"]), (self.other, 100, "IN_STOCK"))
        self.assertEqual(len(live_movements(self.roll)), self.count)
        self.assertEqual((batch_qty(self.roll, self.home), batch_qty(self.roll, self.other)), (0, 100))
        (entry,) = frappe.get_all("Stock Entry Detail", filters={"batch_no": self.roll, "docstatus": 1,
                                                                  "t_warehouse": self.other},
                                  fields=["parent", "s_warehouse", "qty"])
        self.assertEqual((entry.s_warehouse, entry.qty), (self.home, 100))
        se = frappe.db.get_value("Stock Entry", entry.parent, ["purpose", "owner"], as_dict=True)
        self.assertEqual((se.purpose, se.owner), ("Material Transfer", self.user))
        self.assertLedgerAgrees(self.roll)

    def test_after_a_location_change_the_roll_moves_on_and_can_be_deleted(self):
        correct_roll(self.roll, {"location": self.other})
        move(self.roll, "OUT", location=self.running)
        move(self.roll, "RETURN", returned_weight=60)
        self.assertEqual(frappe.db.get_value("Batch", self.roll, "rt_location"), self.other)
        self.assertLedgerAgrees(self.roll)
        delete_roll(self.roll)
        self.assertEqual(batch_qty(self.roll), 0)

    def test_remaining_and_location_together(self):
        correct_roll(self.roll, {"remaining_weight": 70, "location": self.other})
        self.assertEqual(len(live_movements(self.roll)), self.count + 1)
        self.assertEqual((batch_qty(self.roll, self.home), batch_qty(self.roll, self.other)), (0, 70))
        self.assertLedgerAgrees(self.roll)

    def test_locked_and_refused(self):
        cases = [
            ({"material": make_material()}, "Material can't be changed after the roll has moved"),
            ({"weight": 120}, "Weight is locked once the roll has moved"),
            ({"weight": 120, "remaining_weight": 120}, "Weight is locked once the roll has moved"),
            ({"remaining_weight": 151}, "This roll only ever held 150 kg — the counted amount cannot be higher"),
            ({"remaining_weight": -1}, "Remaining weight cannot be negative"),
            ({"remaining_weight": "abc"}, "Remaining weight must be a number"),
            ({"location": "no-such-place"}, "That location no longer exists — pick another"),
            # Nothing is written when any part is refused.
            ({"remaining_weight": 80, "material": make_material()}, "Material can't be changed"),
            ({"remaining_weight": 80, "location": "no-such-place"}, "That location no longer exists"),
            ({"location": self.other, "weight": 99}, "Weight is locked"),
            ({"remaining_weight": 0, "location": self.other}, "holds no stock"),
        ]
        for changes, message in cases:
            with self.subTest(changes=changes):
                self.assertRefused(self.roll, changes, message)

    def test_unchanged_locked_fields_are_ignored(self):
        material = frappe.db.get_value("Batch", self.roll, "item")
        r = correct_roll(self.roll, {"weight": 150, "material": material, "remaining_weight": 90})
        self.assertEqual(r["remaining_weight"], 90)
        self.assertLedgerAgrees(self.roll)

    def test_a_roll_out_on_the_floor_cannot_change_location(self):
        move(self.roll, "OUT", location=self.running)
        self.assertRefused(self.roll, {"location": self.other}, "out")
        # Its remaining weight can still be corrected where it is.
        correct_roll(self.roll, {"remaining_weight": 90})
        self.assertEqual(batch_qty(self.roll, self.running), 90)
        self.assertLedgerAgrees(self.roll)

    def test_a_finished_roll_holds_nothing_to_correct(self):
        move(self.roll, "SELL", buyer=make_buyer())
        self.assertRefused(self.roll, {"location": self.other}, "holds no stock")
        self.assertRefused(self.roll, {"remaining_weight": 50}, "finished")
        consumed = register_roll(base_roll(location=self.home))["name"]
        move(consumed, "OUT", location=self.running)
        move(consumed, "RETURN", returned_weight=0)
        self.assertRefused(consumed, {"location": self.other}, "holds no stock")
        self.assertRefused(consumed, {"remaining_weight": 50}, "finished")

    def test_an_inactive_location_is_refused(self):
        inactive = make_location()
        frappe.db.set_value("Warehouse", inactive, "disabled", 1)
        self.assertRefused(self.roll, {"location": inactive}, "is inactive")
