import uuid

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.sync import run_batch
from royal_touche.tests.factories import base_roll, make_material, standard_locations
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


class TestConcurrentRetry(IntegrationTestCase):
    """Two copies of one request racing: both miss the replay lookup, the unique index lets
    one through, and the other must get that one's result — not a duplicate error."""

    def test_roll_retry_that_lost_the_race_returns_the_winner(self):
        from unittest.mock import patch

        from royal_touche.rolls import register_roll

        key = cid()
        first = register_roll(base_roll(client_id=key))
        retry = base_roll(client_id=key)  # built outside the patch: base_roll's lot does a lookup too
        with patch("royal_touche.replay.find", side_effect=[None, first["name"]]) as find:
            again = register_roll(retry)
        self.assertEqual(again["name"], first["name"])
        self.assertEqual(find.call_count, 2)

    def test_movement_retry_that_lost_the_race_returns_the_winner(self):
        from unittest.mock import patch

        from royal_touche.movements import record_movement
        from royal_touche.rolls import register_roll

        loc = standard_locations()
        roll = register_roll(base_roll(location=loc["GODOWN-A-1"]))["name"]
        key = cid()
        body = {"movement_type": "OUT", "roll": roll, "location": loc["RUNNING-1"],
                "transaction_date": now_iso(), "recorded_at": now_iso(), "client_id": key}
        first = record_movement(dict(body))
        with patch("royal_touche.replay.find", side_effect=[None, first["movement"]["name"]]) as find:
            again = record_movement(dict(body))
        self.assertEqual(again["movement"]["name"], first["movement"]["name"])
        self.assertEqual(find.call_count, 2)

    def test_lot_and_vendor_retries_that_lost_the_race_return_the_winner(self):
        from unittest.mock import patch

        from royal_touche.lots import create_lot
        from royal_touche.masters import create_vendor

        key = cid()
        first = create_lot({"document_type": "challan", "document_no": "RACE-1", "client_id": key})
        with patch("royal_touche.replay.find", side_effect=[None, first["name"]]):
            again = create_lot({"document_type": "challan", "document_no": "RACE-1", "client_id": key})
        self.assertEqual(again["name"], first["name"])

        key = cid()
        first = create_vendor({"vendor_code": "RACEV", "name": "Race Vendor", "client_id": key})
        with patch("royal_touche.replay.find", side_effect=[None, first["name"]]):
            again = create_vendor({"vendor_code": "RACEV", "name": "Race Vendor", "client_id": key})
        self.assertEqual(again["name"], first["name"])
