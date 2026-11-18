from datetime import datetime, timedelta

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.checks import ledger_mismatches, stock_summary
from royal_touche.dates import IST
from royal_touche.rolls import register_roll
from royal_touche.tests.factories import base_roll, make_buyer, make_material, standard_locations, today_ist
from royal_touche.tests.test_movements import move


class TestChecks(IntegrationTestCase):
    def setUp(self):
        loc = standard_locations()
        self.home, self.running = loc["GODOWN-A-1"], loc["RUNNING-1"]
        self.material = make_material()
        # Received two days ago, so a late movement dated yesterday finds them already in stock.
        self.rolls = [
            register_roll(base_roll(material=self.material, location=self.home, weight=w, date=today_ist(2)))["name"]
            for w in (150, 120, 90)
        ]

    def lifecycle(self):
        a, b, c = self.rolls
        move(a, "OUT", location=self.running)
        move(a, "RETURN", returned_weight=80)          # a: 80 in stock
        move(b, "OUT", location=self.running)
        move(b, "CONSUME")                             # b: consumed
        move(c, "ADJUSTMENT", new_weight=70, remarks="Recount")  # c: 70 in stock
        return a, b, c

    def test_ledger_agrees_after_a_full_lifecycle(self):
        self.lifecycle()
        extra = register_roll(base_roll(material=self.material, location=self.home, weight=60))["name"]
        move(extra, "SELL", buyer=make_buyer())
        extra2 = register_roll(base_roll(material=self.material, location=self.home, weight=40))["name"]
        move(extra2, "RETURN_TO_VENDOR")
        self.assertEqual(ledger_mismatches(self.rolls + [extra, extra2]), [])

    def test_a_wrong_cached_weight_is_reported(self):
        a, _, _ = self.lifecycle()
        frappe.db.set_value("Batch", a, "rt_remaining_weight", 79)
        self.addCleanup(frappe.db.set_value, "Batch", a, "rt_remaining_weight", 80)
        self.assertEqual(ledger_mismatches(self.rolls), [{"roll": a, "expected_kg": 79.0, "ledger_kg": 80.0}])

    def test_late_offline_movement_dated_yesterday_keeps_agreement(self):
        a, _, c = self.lifecycle()
        yesterday = (datetime.now(IST) - timedelta(days=1)).isoformat(timespec="seconds")
        move(c, "OUT", location=self.running, transaction_date=yesterday)
        self.assertEqual(ledger_mismatches(self.rolls), [])

    def test_stock_summary_counts_live_in_stock_rolls(self):
        self.lifecycle()
        row = next(r for r in stock_summary() if r["material"] == self.material)
        self.assertEqual((row["on_hand_kg"], row["rolls_in_stock"]), (150.0, 2))
