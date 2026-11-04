from datetime import datetime, timedelta, timezone

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.dates import IST
from royal_touche.errors import RTConflict, RTValidation
from royal_touche.movements import record_movement
from royal_touche.rolls import register_roll
from royal_touche.checks import ledger_mismatches
from royal_touche.tests.factories import base_roll, batch_qty, make_buyer, make_material, standard_locations, today_ist


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

    def test_the_roll_is_read_under_its_row_lock(self):
        """A portal correction (roll_corrections.plan_correction) locks the roll's Batch row. A
        movement must take the same lock, and read the roll with it: under REPEATABLE READ a
        plain read after the lock still sees the snapshot from before a correction committed."""
        from unittest.mock import patch

        with patch.object(frappe.db, "sql", wraps=frappe.db.sql) as spy:
            self.out()
        reads = [str(c.args[0]) for c in spy.call_args_list
                 if c.args and "tabBatch" in str(c.args[0]) and str(c.args[0]).lstrip().upper().startswith("SELECT *")]
        self.assertTrue(reads, "the movement never read its roll")
        self.assertIn("FOR UPDATE", reads[0].upper(), reads[0])

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
    def test_sell_without_a_buyer_goes_to_direct_sale(self):
        # The app's sell dialog has no buyer picker (user directive: the app's screens don't
        # change), so a sale with no buyer is recorded against the default buyer.
        from royal_touche.setup.install import DIRECT_SALE_BUYER

        res = move(self.roll, "SELL")
        self.assertEqual((res["roll"]["status"], res["movement"]["buyer"]), ("SOLD", DIRECT_SALE_BUYER))
        note = frappe.get_doc("Delivery Note", res["movement"]["stock_docname"])
        self.assertEqual(note.customer, DIRECT_SALE_BUYER)

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

    def test_no_movement_type_can_be_dated_in_the_future(self):
        tomorrow = (datetime.now(IST) + timedelta(days=1)).isoformat(timespec="seconds")
        with self.assertRaisesRegex(RTValidation, "The date cannot be in the future"):
            move(self.roll, "ADJUSTMENT", new_weight=100, remarks="x", transaction_date=tomorrow, recorded_at=tomorrow)
        self.out()
        move(self.roll, "RETURN", returned_weight=100)
        with self.assertRaisesRegex(RTValidation, "The date cannot be in the future"):
            move(self.roll, "IN", weight=10, transaction_date=tomorrow, recorded_at=tomorrow)

    def test_same_client_id_returns_the_first_movement(self):
        cid = frappe.generate_hash(length=16)
        a = self.out(client_id=cid)
        b = self.out(client_id=cid)
        self.assertEqual(a["movement"]["name"], b["movement"]["name"])
        self.assertEqual(frappe.db.count("Roll Movement", {"client_id": cid}), 1)

    def test_movement_photos_must_be_files_this_server_holds(self):
        with self.assertRaisesRegex(RTValidation, "Photos must be files uploaded to this server"):
            self.out(photos=["/api/method/frappe.client.get_list?doctype=User"])

    def test_descriptions_read_as_on_the_old_server(self):
        vendor = frappe.db.get_value("Batch", self.roll, "rt_vendor")
        vendor_name = frappe.db.get_value("Supplier", vendor, "supplier_name")
        running, home = (frappe.db.get_value("Warehouse", w, "warehouse_name") for w in (self.running, self.home))
        mv = lambda r: r["movement"]["description"]  # noqa: E731
        self.assertEqual(mv(self.out()), f"Issued out 150 kg to {running}")
        self.assertEqual(mv(move(self.roll, "RETURN", returned_weight=80)), f"Returned 80 kg to {home} · 70 kg used")
        self.assertEqual(mv(move(self.roll, "ADJUSTMENT", new_weight=70, remarks="x")), "Corrected by 10 kg")
        self.assertEqual(mv(move(self.roll, "RETURN_TO_VENDOR")), f"Returned to vendor {vendor_name} — 70 kg")
        other = register_roll(base_roll(location=self.home, weight=150))["name"]
        self.assertEqual(mv(move(other, "SELL")), "Sold — 150 kg")
        third = register_roll(base_roll(location=self.home, weight=150))["name"]
        self.assertEqual(mv(move(third, "CONSUME")), "Consumed — 150 kg used up")
        from royal_touche.movements import movement_dict

        name = frappe.db.get_value("Roll Movement", {"roll": third, "movement_type": "IN"})
        self.assertEqual(movement_dict(name)["description"], "Received 150 kg")

    def test_used_weight_is_empty_except_where_weight_was_used(self):
        out = self.out()["movement"]
        self.assertIsNone(out["used_weight"])
        self.assertEqual(move(self.roll, "RETURN", returned_weight=150)["movement"]["used_weight"], 0)
        other = register_roll(base_roll(location=self.home))["name"]
        self.assertEqual(move(other, "CONSUME")["movement"]["used_weight"], 150)

    def test_more_than_four_photos_rejected(self):
        with self.assertRaisesRegex(RTValidation, "At most 4 photos per movement"):
            from royal_touche.tests.factories import make_file

            self.out(photos=[make_file() for _ in range(5)])


class TestLedgerTiming(IntegrationTestCase):
    """The date on a Roll Movement is the business date; the stock ledger needs an order it can
    accept. A picked day must never make a movement impossible."""

    def setUp(self):
        self.loc = standard_locations()
        self.home, self.running = self.loc["GODOWN-A-1"], self.loc["RUNNING-1"]

    def yesterday(self) -> str:
        return (datetime.now(IST) - timedelta(days=1)).isoformat(timespec="seconds")

    def posted(self, movement: dict) -> datetime:
        doc = frappe.get_doc(movement["stock_doctype"], movement["stock_docname"])
        return frappe.utils.get_datetime(f"{doc.posting_date} {frappe.utils.get_time(doc.posting_time)}")

    def test_a_zoned_time_posts_the_ledger_at_india_time(self):
        roll = register_roll(base_roll(location=self.home, date=today_ist(3)))["name"]
        at = (datetime.now(IST) - timedelta(days=1)).replace(hour=2, minute=0, second=0, microsecond=0)
        utc = at.astimezone(timezone.utc).isoformat()
        res = move(roll, "OUT", location=self.running, transaction_date=utc, recorded_at=now_iso())
        self.assertEqual(self.posted(res["movement"]), at.replace(tzinfo=None))
        self.assertEqual(str(res["movement"]["transaction_date"]), at.strftime("%Y-%m-%d %H:%M:%S"))

    def test_a_zoned_time_just_after_midnight_stays_on_its_india_day(self):
        roll = register_roll(base_roll(location=self.home, date=today_ist(3)))["name"]
        at = (datetime.now(IST) - timedelta(days=1)).replace(hour=0, minute=30, second=0, microsecond=0)
        res = move(roll, "OUT", location=self.running, transaction_date=at.astimezone(timezone.utc).isoformat(),
                   recorded_at=now_iso())
        self.assertEqual(self.posted(res["movement"]).date(), at.date())

    def test_out_dated_yesterday_on_a_roll_received_today(self):
        roll = register_roll(base_roll(location=self.home, date=today_ist()))["name"]
        day = self.yesterday()
        res = move(roll, "OUT", location=self.running, transaction_date=day)
        self.assertEqual(res["roll"]["status"], "ISSUED")
        self.assertEqual(str(res["movement"]["transaction_date"]), day[:19].replace("T", " "))
        self.assertEqual((batch_qty(roll, self.home), batch_qty(roll, self.running)), (0, 150))
        self.assertEqual(ledger_mismatches([roll]), [])

    def test_return_dated_before_its_out(self):
        roll = register_roll(base_roll(location=self.home, date=today_ist()))["name"]
        move(roll, "OUT", location=self.running)
        res = move(roll, "RETURN", returned_weight=80, transaction_date=self.yesterday())
        self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"]), ("IN_STOCK", 80))
        self.assertEqual((batch_qty(roll, self.home), batch_qty(roll, self.running)), (80, 0))
        self.assertEqual(ledger_mismatches([roll]), [])

    def test_roll_with_no_date_then_a_date_only_movement_today(self):
        roll = register_roll(base_roll(location=self.home, date=None))["name"]
        res = move(roll, "OUT", location=self.running, transaction_date=today_ist())
        self.assertEqual(res["roll"]["status"], "ISSUED")
        self.assertEqual(ledger_mismatches([roll]), [])

    def test_timed_out_then_a_date_only_return_today(self):
        roll = register_roll(base_roll(location=self.home, date=today_ist()))["name"]
        move(roll, "OUT", location=self.running)
        res = move(roll, "RETURN", returned_weight=0, transaction_date=today_ist())
        self.assertEqual(res["roll"]["status"], "CONSUMED")
        self.assertEqual(ledger_mismatches([roll]), [])

    def test_every_finish_works_out_of_order(self):
        for action, extra in (("SELL", {"buyer": make_buyer()}), ("RETURN_TO_VENDOR", {}), ("CONSUME", {})):
            roll = register_roll(base_roll(location=self.home, date=today_ist()))["name"]
            move(roll, action, transaction_date=self.yesterday(), **extra)
            self.assertEqual(batch_qty(roll), 0, action)
            self.assertEqual(ledger_mismatches([roll]), [], action)

    def test_delete_undoes_out_of_order_history(self):
        from royal_touche.rolls import delete_roll

        roll = register_roll(base_roll(location=self.home, date=today_ist()))["name"]
        move(roll, "OUT", location=self.running, transaction_date=self.yesterday())
        delete_roll(roll)
        self.assertEqual(batch_qty(roll), 0)


class TestRetiredMastersMidway(IntegrationTestCase):
    def test_a_roll_returns_where_it_is_when_its_home_rack_was_retired(self):
        loc = standard_locations()
        from royal_touche.tests.factories import make_location, unique

        home = make_location(unique("OLD-RACK"))
        roll = register_roll(base_roll(location=home))["name"]
        move(roll, "OUT", location=loc["RUNNING-1"])
        rack = frappe.get_doc("Warehouse", home)
        rack.disabled = 1
        rack.save()
        res = move(roll, "RETURN", returned_weight=80)
        self.assertEqual((res["roll"]["status"], res["roll"]["location"]), ("IN_STOCK", loc["RUNNING-1"]))
        self.assertEqual(batch_qty(roll, loc["RUNNING-1"]), 80)


class TestPricesStayWhereTheyWereGiven(IntegrationTestCase):
    def test_a_priced_roll_does_not_price_the_next_receipt(self):
        material = make_material()
        register_roll(base_roll(material=material, rate_per_roll=4500))
        plain = register_roll(base_roll(material=material))
        receipt = frappe.get_doc("Purchase Receipt", frappe.db.get_value("Batch", plain["name"], "rt_purchase_receipt"))
        self.assertEqual((receipt.items[0].rate, receipt.items[0].amount), (0, 0))
        self.assertEqual(frappe.db.count("Item Price", {"item_code": material}), 0)

    def test_a_priced_sale_does_not_price_the_next_sale(self):
        material = make_material()
        buyer = make_buyer()
        one = register_roll(base_roll(material=material))["name"]
        two = register_roll(base_roll(material=material))["name"]
        move(one, "SELL", buyer=buyer, rate_per_roll=6000)
        res = move(two, "SELL", buyer=buyer)
        note = frappe.get_doc("Delivery Note", res["movement"]["stock_docname"])
        self.assertEqual((note.items[0].rate, note.grand_total), (0, 0))
        self.assertEqual(frappe.db.count("Item Price", {"item_code": material}), 0)
