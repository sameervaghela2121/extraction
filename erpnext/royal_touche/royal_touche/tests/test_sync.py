import uuid

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.lots import create_lot
from royal_touche.masters import create_vendor
from royal_touche.movements import record_movement
from royal_touche.rolls import register_roll
from royal_touche.sync import run_batch
from royal_touche.tests.factories import base_roll, make_location, standard_locations, unique
from royal_touche.tests.test_movements import now_iso


def cid() -> str:
    return str(uuid.uuid4())


def roll_item(client_id: str, **body) -> dict:
    return {"type": "roll", "client_id": client_id, "body": base_roll(**body)}


def movement_item(client_id: str, **body) -> dict:
    roll_client_id = body.pop("roll_client_id", None)
    body.setdefault("transaction_date", now_iso())
    body.setdefault("recorded_at", now_iso())
    item = {"type": "movement", "client_id": client_id, "body": body}
    if roll_client_id:
        item["roll_client_id"] = roll_client_id
    return item


class TestSync(IntegrationTestCase):
    def setUp(self):
        self.loc = standard_locations()

    def statuses(self, res):
        return [r["status"] for r in res["results"]]

    def test_roll_and_its_movement_in_one_batch(self):
        a = cid()
        res = run_batch([roll_item(a), movement_item(cid(), movement_type="OUT", roll_client_id=a, location=self.loc["RUNNING-1"])])
        self.assertEqual(self.statuses(res), ["ok", "ok"])
        roll = res["results"][0]["data"]["name"]
        self.assertEqual(frappe.db.get_value("Batch", roll, "rt_status"), "ISSUED")

    def test_lot_vendor_and_paper_created_offline_are_used_by_a_roll(self):
        lot, vendor, paper = cid(), cid(), cid()
        roll_body = base_roll(lot=None, vendor=None, rt_code="777")
        roll_body.update({"lot_client_id": lot, "vendor_client_id": vendor})
        res = run_batch(
            [
                {"type": "roll", "client_id": cid(), "body": roll_body},
                {"type": "lot", "client_id": lot, "body": {"document_type": "challan", "document_no": "OFF-1"}},
                {"type": "vendor", "client_id": vendor, "body": {"vendor_code": "OFFV", "name": "Offline Vendor"}},
                {"type": "supplier_code", "client_id": paper,
                 "body": {"vendor_client_id": vendor, "papers": [{"paper_code": "P-1", "rt_code": "777"}]}},
            ]
        )
        self.assertEqual(self.statuses(res), ["ok", "ok", "ok", "ok"])
        # Results keep the position each item arrived at, though masters ran first.
        self.assertEqual([r["index"] for r in res["results"]], [0, 1, 2, 3])
        self.assertEqual(res["results"][0]["data"]["rt_code"], "777")

    def test_replaying_a_half_applied_batch(self):
        a, c = cid(), cid()
        first = run_batch([roll_item(a), roll_item(c, lot=None)])
        self.assertEqual(self.statuses(first), ["ok", "failed"])
        again = run_batch([roll_item(a), roll_item(c)])
        self.assertEqual(self.statuses(again), ["ok", "ok"])
        self.assertEqual(again["results"][0]["data"]["name"], first["results"][0]["data"]["name"])
        self.assertEqual(frappe.db.count("Batch", {"rt_client_id": a}), 1)

    def test_a_failed_roll_skips_only_its_own_movements(self):
        bad, good = cid(), cid()
        res = run_batch(
            [
                roll_item(bad, lot=None),
                movement_item(cid(), movement_type="OUT", roll_client_id=bad, location=self.loc["RUNNING-1"]),
                roll_item(good),
            ]
        )
        self.assertEqual(self.statuses(res), ["failed", "skipped", "ok"])
        self.assertEqual(res["results"][1]["reason"], "dependency_failed")

    def test_a_failed_movement_skips_later_movements_on_the_same_roll(self):
        a = cid()
        res = run_batch(
            [
                roll_item(a),
                movement_item(cid(), movement_type="RETURN", roll_client_id=a, returned_weight=10),
                movement_item(cid(), movement_type="OUT", roll_client_id=a, location=self.loc["RUNNING-1"]),
            ]
        )
        self.assertEqual(self.statuses(res), ["ok", "failed", "skipped"])
        self.assertEqual(res["results"][1]["reason"], "conflict")

    def test_reasons(self):
        a = cid()
        dup = base_roll()
        res = run_batch(
            [
                {"type": "roll", "client_id": a, "body": dup},
                {"type": "roll", "client_id": cid(), "body": dict(dup)},
                roll_item(cid(), weight=0),
            ]
        )
        self.assertEqual([r.get("reason") for r in res["results"]], [None, "duplicate", "validation"])
        self.assertEqual(res["results"][1]["code"], 409)

    def test_limits(self):
        with self.assertRaisesRegex(frappe.ValidationError, "A batch cannot exceed 50 items — send the rest in the next call"):
            run_batch([roll_item(cid()) for _ in range(51)])
        same = cid()
        with self.assertRaisesRegex(frappe.ValidationError, "Every item needs its own client_id"):
            run_batch([roll_item(same), roll_item(same)])
        with self.assertRaisesRegex(frappe.ValidationError, "client_id must be a UUID"):
            run_batch([roll_item("not-a-uuid")])
        with self.assertRaisesRegex(frappe.ValidationError, "Nothing to sync"):
            run_batch([])

    def test_writes_a_sync_log(self):
        before = frappe.db.count("Sync Log")
        run_batch([roll_item(cid()), roll_item(cid(), lot=None)])
        self.assertEqual(frappe.db.count("Sync Log"), before + 1)
        log = frappe.get_last_doc("Sync Log")
        self.assertEqual((log.item_count, log.applied, log.failed, log.skipped), (2, 1, 1, 0))


class TestRacingRetries(IntegrationTestCase):
    """Two copies of one request on two real database connections. The loser's transaction
    began before the winner committed, so its ordinary reads cannot see the winner (MariaDB's
    REPEATABLE READ). It must still end up with the winner's result, not an error."""

    def open_snapshot(self):
        with self.primary_connection():
            frappe.db.sql("select name from tabBatch limit 1")

    def committed(self, fn):
        with self.secondary_connection():
            result = fn()
            frappe.db.commit()
        return result

    def test_lot(self):
        key = cid()
        body = {"document_type": "challan", "document_no": "RACE-LOT", "client_id": key}
        self.open_snapshot()
        winner = self.committed(lambda: create_lot(dict(body)))
        with self.primary_connection():
            self.assertEqual(create_lot(dict(body))["name"], winner["name"])

    def test_vendor(self):
        key = cid()
        body = {"vendor_code": unique("RACEV"), "name": unique("Race Vendor"), "client_id": key}
        self.open_snapshot()
        winner = self.committed(lambda: create_vendor(dict(body)))
        with self.primary_connection():
            again = create_vendor(dict(body))
        self.assertEqual((again["name"], again["vendor_code"]), (winner["name"], winner["vendor_code"]))

    def test_roll(self):
        key, number = cid(), unique("RACER")
        self.open_snapshot()
        winner = self.committed(lambda: register_roll(base_roll(client_id=key, roll_number=number, location=None)))
        with self.primary_connection():
            retry = base_roll(client_id=key, roll_number=number, location=None)
            again = register_roll(retry)
            self.assertEqual((again["name"], again["roll_number"], again["weight"]), (winner["name"], number.upper(), 150))
            self.assertEqual(frappe.db.sql("select count(*) from tabBatch where rt_client_id=%s for update", key)[0][0], 1)

    def test_movement(self):
        key = cid()

        def setup():
            here, there = make_location(unique("RACE-A")), make_location(unique("RACE-B"))
            return here, there, register_roll(base_roll(location=here))["name"]

        here, there, roll = self.committed(setup)
        self.open_snapshot()
        body = {"movement_type": "OUT", "roll": roll, "location": there, "client_id": key,
                "transaction_date": now_iso(), "recorded_at": now_iso()}
        winner = self.committed(lambda: record_movement(dict(body)))
        with self.primary_connection():
            again = record_movement(dict(body))
        self.assertEqual(again["movement"]["name"], winner["movement"]["name"])
        self.assertEqual((again["roll"]["status"], again["roll"]["location"]), ("ISSUED", there))

    def test_batch_item(self):
        key = cid()
        body = {"document_type": "invoice", "document_no": "RACE-BATCH", "client_id": key}
        self.open_snapshot()
        winner = self.committed(lambda: create_lot(dict(body)))
        with self.primary_connection():
            res = run_batch([{"type": "lot", "client_id": key, "body": {"document_type": "invoice", "document_no": "RACE-BATCH"}}])
        self.assertEqual(res["results"][0]["status"], "ok")
        self.assertEqual(res["results"][0]["data"]["name"], winner["name"])


class TestBatchItemsStandAlone(TestRacingRetries):
    """Each item commits on its own, as on the old server: visible at once, and a failure or a
    deadlock costs that item only."""

    def lot(self, key=None, no="ALONE-1"):
        return {"type": "lot", "client_id": key or cid(), "body": {"document_type": "challan", "document_no": no}}

    def test_an_item_is_visible_to_others_before_the_batch_ends(self):
        from unittest.mock import patch

        from royal_touche import sync

        first, seen = cid(), []
        real = sync._run_item

        def spy(item, *args):
            if item["client_id"] != first:
                with self.secondary_connection():
                    frappe.db.rollback()  # a fresh read
                    seen.append(frappe.db.exists("Roll Lot", {"client_id": first}))
            return real(item, *args)

        with self.primary_connection(), patch("royal_touche.sync._run_item", side_effect=spy):
            run_batch([self.lot(first), self.lot(no="ALONE-2")], commit_each=True)
        self.assertTrue(seen and seen[0])

    def test_a_deadlock_is_retried_and_the_batch_carries_on(self):
        from unittest.mock import patch

        from royal_touche import sync

        real, calls = sync._run_item, []

        def flaky(item, *args):
            calls.append(item["client_id"])
            if len(calls) == 1:
                frappe.db.rollback()  # a real deadlock ends the transaction, savepoint included
                raise frappe.QueryDeadlockError("Deadlock found")
            return real(item, *args)

        with patch("royal_touche.sync._run_item", side_effect=flaky):
            res = run_batch([self.lot(no="ALONE-3")], commit_each=True)
        self.assertEqual((len(calls), res["results"][0]["status"]), (2, "ok"))

    def test_a_deadlock_twice_fails_that_item_only_and_can_be_retried(self):
        from unittest.mock import patch

        from royal_touche import sync

        real = sync._run_item
        stuck = cid()

        def always(item, *args):
            if item["client_id"] == stuck:
                frappe.db.rollback()
                raise frappe.QueryDeadlockError("Deadlock found")
            return real(item, *args)

        with patch("royal_touche.sync._run_item", side_effect=always):
            res = run_batch([self.lot(stuck, "ALONE-4"), self.lot(no="ALONE-5")], commit_each=True)
        self.assertEqual([r["status"] for r in res["results"]], ["failed", "ok"])
        self.assertEqual(res["results"][0]["reason"], "server_error")
