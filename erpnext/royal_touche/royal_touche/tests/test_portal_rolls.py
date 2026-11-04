"""The portal's rolls and their history (royal_touche.api.portal_rolls), checked against what the
old Node server answered (backend/src/services/materialRolls.service.ts list/get/create/update/
remove, stock.service.ts listMovements, and the role rules in routes/{materialRolls,stock}.routes.ts)."""

import re

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.api import portal_rolls as api
from royal_touche.errors import RTDuplicate, RTNotFound, RTValidation
from royal_touche.tests.factories import (
    PAPER,
    as_user,
    make_file,
    make_location,
    make_lot,
    make_material,
    make_remark,
    make_user,
    make_vendor,
    today_ist,
    unique,
)
from royal_touche.tests.test_movements import move

ISO_UTC = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
NODE_PAPER = {"royal_touche_code": PAPER["rt_code"], "delta_code": PAPER["delta_code"],
              "supplier_code_number": PAPER["paper_code"]}
# remark_codes and empty photo paths are absent, as Node left them undefined.
ROLL_KEYS = {"id", "roll_number", "royal_touche_code", "papers", "barcode", "material_id",
             "vendor_id", "lot", "weight", "remaining_weight", "unit", "gsm", "width", "location", "date",
             "status", "tag_photo_url", "stitched_barcode_photo_url",
             "side1_photo_url", "side2_photo_url", "deleted_at", "createdAt", "updatedAt"}
MOVEMENT_KEYS = {"id", "transaction_type", "transaction_date", "material_id", "roll_id", "vendor_id", "weight",
                 "used_weight", "description", "from_location", "to_location", "roll_weight_after", "remarks",
                 "photo_paths", "photo_urls", "created_by", "createdAt", "updatedAt"}


def body(**over) -> dict:
    """What NewRollModal sends: Node's field names, ERPNext's ids."""
    data = {
        "lot_id": make_lot(),
        "barcode": unique("BC"),
        "roll_number": unique("R"),
        "material_id": make_material(),
        "vendor_id": make_vendor(papers=[dict(PAPER)]),
        "papers": [dict(NODE_PAPER)],
        "weight": 150,
        "gsm": 80,
        "width": 1250,
        "location": make_location("GODOWN-A-1", "Godown A side 1", "Godown A", 10),
        "date": today_ist(),
    }
    data.update(over)
    return data


class PortalRollsCase(IntegrationTestCase):
    def setUp(self):
        self.admin = make_user("RT Admin")
        self.operator = make_user("Godown Operator")
        self.outsider = make_user("Accounts User")
        frappe.set_user(self.admin)

    def tearDown(self):
        frappe.set_user("Administrator")


class TestCreate(PortalRollsCase):
    def test_returns_the_node_roll_shape(self):
        side1, side2 = make_file(), make_file()
        b = body(roll_number="abc-" + unique("x"), side1_photo_path=side1, side2_photo_path=side2)
        r = api.create(**b)
        self.assertTrue(ROLL_KEYS <= set(r), ROLL_KEYS - set(r))
        self.assertEqual(r["roll_number"], b["roll_number"].upper())
        self.assertEqual(r["barcode"], b["barcode"].upper())
        self.assertEqual(r["material_id"]["id"], b["material_id"])
        self.assertEqual(set(r["material_id"]), {"id", "name"})
        vendor = frappe.db.get_value("Supplier", b["vendor_id"], ["supplier_name", "rt_vendor_code"], as_dict=True)
        self.assertEqual(r["vendor_id"], {"id": b["vendor_id"], "name": vendor.supplier_name,
                                          "vendor_code": vendor.rt_vendor_code})
        lot = frappe.db.get_value("Roll Lot", b["lot_id"], ["document_type", "document_no"], as_dict=True)
        self.assertEqual(r["lot"], {"id": b["lot_id"], "document_type": lot.document_type,
                                    "document_no": lot.document_no})
        self.assertEqual(r["location"], {"id": b["location"], "location_code": "GODOWN-A-1",
                                         "name": "Godown A side 1"})
        self.assertEqual(r["papers"], [NODE_PAPER])
        self.assertEqual(r["royal_touche_code"], PAPER["rt_code"])
        self.assertEqual((r["weight"], r["remaining_weight"], r["gsm"], r["width"], r["unit"], r["status"]),
                         (150, 150, 80, 1250, "kg", "IN_STOCK"))
        # A picked day reads back as Node stored it: that day's UTC midnight.
        self.assertEqual(r["date"], f"{b['date']}T00:00:00.000Z")
        self.assertRegex(r["createdAt"], ISO_UTC)
        self.assertRegex(r["updatedAt"], ISO_UTC)
        self.assertIsNone(r["deleted_at"])
        self.assertEqual((r["side1_photo_path"], r["side2_photo_path"]), (side1, side2))
        # The server returns paths; the portal turns them into links it can open with its token.
        self.assertIsNone(r["side1_photo_url"])
        self.assertNotIn("remark_codes", r)
        self.assertNotIn("tag_photo_path", r)  # undefined in Node: absent, not null

    def test_registration_photos_go_on_the_in_movement(self):
        side1, side2 = make_file(), make_file()
        r = api.create(**body(side1_photo_path=side1, side2_photo_path=side2))
        page = api.movements(roll_id=r["id"])
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["items"][0]["photo_paths"], [side1, side2])

    def test_validation_messages(self):
        cases = [
            ({"lot_id": None}, "Select the lot (challan or invoice) this roll came in on"),
            ({"weight": 0}, "Weight must be greater than 0"),
            ({"weight": None}, "Weight is required"),
            ({"gsm": -1}, "GSM must be greater than 0"),
            ({"width": 0}, "Width must be greater than 0"),
            ({"roll_number": "  "}, "Roll number is required"),
            ({"date": None}, "Date is required"),
            ({"material_id": None}, "material_id: Required"),
            ({"vendor_id": None}, "vendor_id: Required"),
            ({"location": None}, "location: Required"),
            ({"papers": []}, "papers: Pick at least one paper"),
            ({"papers": [{"royal_touche_code": "999"}]}, "Paper RT 999 is not one of .*'s papers"),
            ({"material_id": "no-such-item"}, "That material no longer exists — pick another"),
            ({"lot_id": "no-such-lot"}, "That lot no longer exists — pick another"),
            ({"side1_photo_path": "/private/files/nothing-here.jpg"}, "Photos must be files uploaded to this server"),
            ({"client_id": "not-a-uuid"}, "client_id must be a UUID"),
        ]
        for over, message in cases:
            b = body()
            for k, v in over.items():
                if v is None:
                    b.pop(k)
                else:
                    b[k] = v
            pattern = message if ".*" in message else re.escape(message)
            with self.subTest(over=over), self.assertRaisesRegex(RTValidation, pattern):
                api.create(**b)

    def test_several_problems_are_listed_as_node_did(self):
        b = body()
        for k in ("weight", "gsm", "width", "date"):
            b.pop(k)
        with self.assertRaisesRegex(RTValidation, r"^Weight is required, GSM is required, Width is required \(and 1 more\)$"):
            api.create(**b)

    def test_taken_roll_number(self):
        first = api.create(**body())
        with self.assertRaisesRegex(RTDuplicate, "A roll with this number already exists"):
            api.create(**body(roll_number=first["roll_number"].lower()))

    def test_bare_rt_code_from_an_older_client(self):
        b = body()
        b.pop("papers")
        r = api.create(**b, royal_touche_code=PAPER["rt_code"])
        self.assertEqual(r["royal_touche_code"], PAPER["rt_code"])


class TestReadAndSearch(PortalRollsCase):
    def setUp(self):
        super().setUp()
        self.tag = unique("Q").replace("-", "")
        self.rolls = [api.create(**body(roll_number=f"{self.tag}-{n}")) for n in ("B", "A", "C")]

    def test_get_by_id_or_number(self):
        r = self.rolls[0]
        self.assertEqual(api.get(id=r["id"])["id"], r["id"])
        self.assertEqual(api.get(id=r["roll_number"].lower())["id"], r["id"])
        with self.assertRaisesRegex(RTNotFound, "Roll not found"):
            api.get(id="nope-nope")

    def test_search_matches_node_fields_any_case(self):
        page = api.search(q=self.tag.lower())
        self.assertEqual(page["total"], 3)
        self.assertEqual(set(page), {"items", "total", "page", "pageSize", "totalPages"})
        self.assertTrue(ROLL_KEYS <= set(page["items"][0]))
        barcode = self.rolls[1]["barcode"]
        self.assertEqual([r["id"] for r in api.search(q=barcode.lower())["items"]], [self.rolls[1]["id"]])
        # RT, Delta and supplier codes are shared by every roll of the paper.
        for code in (PAPER["rt_code"], PAPER["delta_code"].lower(), PAPER["paper_code"]):
            ids = {r["id"] for r in api.search(q=code, pageSize=100)["items"]}
            self.assertTrue(ids, code)
        # A wildcard in the query is a literal character, not "anything".
        self.assertEqual(api.search(q=f"{self.tag}%")["total"], 0)

    def test_sort_and_paging(self):
        asc = api.search(q=self.tag, sort="roll_number", order="asc")
        self.assertEqual([r["roll_number"][-1] for r in asc["items"]], ["A", "B", "C"])
        desc = api.search(q=self.tag, sort="roll_number", order="desc")
        self.assertEqual([r["roll_number"][-1] for r in desc["items"]], ["C", "B", "A"])
        # Default: newest received first; same day, so the last registered leads.
        default = api.search(q=self.tag)
        self.assertEqual([r["roll_number"][-1] for r in default["items"]], ["C", "A", "B"])
        page2 = api.search(q=self.tag, sort="roll_number", order="asc", page=2, pageSize=2)
        self.assertEqual((page2["total"], page2["page"], page2["pageSize"], page2["totalPages"]), (3, 2, 2, 2))
        self.assertEqual([r["roll_number"][-1] for r in page2["items"]], ["C"])
        with self.assertRaisesRegex(RTValidation, "sort"):
            api.search(q=self.tag, sort="weight")

    def test_sort_by_date_received(self):
        older = api.create(**body(roll_number=f"{self.tag}-OLD", date=today_ist(days_ago=3)))
        asc = api.search(q=self.tag, sort="date", order="asc")
        self.assertEqual(asc["items"][0]["id"], older["id"])
        self.assertEqual(api.search(q=self.tag, sort="date", order="desc")["items"][-1]["id"], older["id"])

    def test_get_list_is_the_same_rolls(self):
        page = api.list_rolls(q=self.tag, page=1, pageSize=2)
        self.assertEqual((page["total"], len(page["items"]), page["totalPages"]), (3, 2, 2))
        item = page["items"][0]
        for key in ("id", "roll_number", "royal_touche_code", "papers", "gsm", "width", "unit", "location", "status"):
            self.assertIn(key, item)

    def test_deleted_rolls_are_hidden(self):
        api.remove(id=self.rolls[0]["id"])
        self.assertEqual(api.search(q=self.tag)["total"], 2)
        with self.assertRaisesRegex(RTNotFound, "Roll not found"):
            api.get(id=self.rolls[0]["id"])

    def test_remark_codes_shape(self):
        from royal_touche.rolls import set_remark_codes

        remark = make_remark(label="Misprint")
        set_remark_codes(self.rolls[0]["id"], [remark])
        code = frappe.db.get_value("RT Remark", remark, "remark_code")
        self.assertEqual(api.get(id=self.rolls[0]["id"])["remark_codes"],
                         [{"id": remark, "remark_code": code, "label": "Misprint", "status": "active"}])


class TestUpdateAndRemove(PortalRollsCase):
    def setUp(self):
        super().setUp()
        self.roll = api.create(**body())

    def test_corrects_what_was_read_off_the_label(self):
        other_lot = make_lot()
        photo = make_file()
        r = api.update(id=self.roll["id"], roll_number="fixed-" + self.roll["roll_number"], gsm=90, width=1300,
                       lot_id=other_lot, side1_photo_path=photo)
        self.assertEqual((r["roll_number"], r["gsm"], r["width"], r["lot"]["id"], r["side1_photo_path"]),
                         ("FIXED-" + self.roll["roll_number"], 90, 1300, other_lot, photo))
        self.assertEqual(r["id"], self.roll["id"])

    def test_refusals_with_node_messages(self):
        cases = [
            ({}, "Provide at least one field to update"),
            ({"status": "SOLD"}, "A roll's status follows its movements — issue or consume it instead"),
            ({"client_id": "x"}, "client_id is set when the roll is created and cannot be changed"),
            # An untouched roll holds what arrived on it: the page sends both figures together.
            ({"remaining_weight": 100}, "weight and remaining weight must be the same"),
            ({"weight": 100}, "weight and remaining weight must be the same"),
            ({"gsm": 0}, "GSM must be greater than 0"),
            ({"location": self.roll["location"]["id"] + "x"}, "That location no longer exists — pick another"),
            ({"material_id": "no-such-item"}, "That material no longer exists — pick another"),
        ]
        for changes, message in cases:
            with self.subTest(changes=changes), self.assertRaisesRegex(RTValidation, re.escape(message)):
                api.update(id=self.roll["id"], **changes)

    def test_unknown_roll(self):
        with self.assertRaisesRegex(RTNotFound, "Roll not found"):
            api.update(id="no-such-roll", gsm=90)

    def test_taken_number(self):
        other = api.create(**body())
        with self.assertRaisesRegex(RTDuplicate, "A roll with this number already exists"):
            api.update(id=self.roll["id"], roll_number=other["roll_number"])

    def test_remove(self):
        move(self.roll["id"], "OUT", location=make_location("RUNNING-1", "Running Godown side 1", "Running Godown", 50))
        self.assertEqual(api.remove(id=self.roll["id"]), {"id": self.roll["id"], "deleted": True})
        self.assertEqual(api.movements(roll_id=self.roll["id"])["total"], 0)
        with self.assertRaisesRegex(RTNotFound, "Roll not found"):
            api.remove(id=self.roll["id"])


class TestCorrections(PortalRollsCase):
    """What the Rolls page's edit form sends (RollsPage.tsx submit): weight and remaining_weight
    together, material and location, for a roll that has not moved; remaining_weight, material
    and location for one that has."""

    def setUp(self):
        super().setUp()
        self.home = make_location("GODOWN-A-1", "Godown A side 1", "Godown A", 10)
        self.other = make_location("GODOWN-B-1", "Godown B side 1", "Godown B", 30)
        self.running = make_location("RUNNING-1", "Running Godown side 1", "Running Godown", 50)
        self.roll = api.create(**body(weight=150, location=self.home))

    def assertLedgerAgrees(self, roll_id):
        from royal_touche.checks import ledger_mismatches

        self.assertEqual(ledger_mismatches([roll_id]), [])

    def test_untouched_roll_is_corrected_with_no_new_history(self):
        material = make_material()
        r = api.update(id=self.roll["id"], weight=120, remaining_weight=120, material_id=material,
                       location=self.other, gsm=95)
        self.assertEqual(r["id"], self.roll["id"])
        self.assertEqual((r["weight"], r["remaining_weight"], r["material_id"]["id"], r["location"]["id"], r["gsm"]),
                         (120, 120, material, self.other, 95))
        page = api.movements(roll_id=self.roll["id"])
        self.assertEqual(page["total"], 1)
        received = page["items"][0]
        self.assertEqual((received["transaction_type"], received["weight"], received["description"]),
                         ("IN", 120, "Received 120 kg"))
        self.assertEqual((received["material_id"]["id"], received["to_location"]["id"]), (material, self.other))
        self.assertEqual(received["transaction_date"], self.roll["date"])
        self.assertLedgerAgrees(self.roll["id"])

    def test_moved_roll_remaining_weight_is_an_adjustment(self):
        move(self.roll["id"], "OUT", location=self.running)
        move(self.roll["id"], "RETURN", returned_weight=100)
        r = api.update(id=self.roll["id"], remaining_weight=90)
        self.assertEqual((r["weight"], r["remaining_weight"]), (150, 90))
        page = api.movements(roll_id=self.roll["id"])
        self.assertEqual(page["total"], 4)
        adj = page["items"][0]
        self.assertEqual((adj["transaction_type"], adj["remarks"], adj["roll_weight_after"], adj["created_by"]["id"]),
                         ("ADJUSTMENT", "Corrected on the portal", 90, self.admin))
        self.assertLedgerAgrees(self.roll["id"])

    def test_moved_roll_location_moves_its_stock(self):
        from royal_touche.tests.factories import batch_qty

        move(self.roll["id"], "OUT", location=self.running)
        move(self.roll["id"], "RETURN", returned_weight=100)
        with as_user(self.operator):
            r = api.update(id=self.roll["id"], location=self.other)
        self.assertEqual(r["location"]["id"], self.other)
        self.assertEqual(api.movements(roll_id=self.roll["id"])["total"], 3)
        self.assertEqual((batch_qty(self.roll["id"], self.home), batch_qty(self.roll["id"], self.other)), (0, 100))
        self.assertLedgerAgrees(self.roll["id"])

    def test_moved_roll_material_and_weight_are_locked(self):
        move(self.roll["id"], "OUT", location=self.running)
        with self.assertRaisesRegex(RTValidation, "Material can't be changed after the roll has moved"):
            api.update(id=self.roll["id"], material_id=make_material())
        with self.assertRaisesRegex(RTValidation, "Weight is locked once the roll has moved"):
            api.update(id=self.roll["id"], weight=120)

    def test_one_refusal_and_nothing_is_written(self):
        move(self.roll["id"], "OUT", location=self.running)
        move(self.roll["id"], "RETURN", returned_weight=100)
        before = api.get(id=self.roll["id"])
        # Label fields are fine, the correction is refused: the label fields are not saved either.
        with self.assertRaisesRegex(RTValidation, "Material can't be changed after the roll has moved"):
            api.update(id=self.roll["id"], gsm=99, remaining_weight=90, material_id=make_material())
        # The correction is fine, a label field is refused: the correction is not written either.
        with self.assertRaisesRegex(RTValidation, "GSM must be greater than 0"):
            api.update(id=self.roll["id"], gsm=0, remaining_weight=90, location=self.other)
        other = api.create(**body())
        with self.assertRaisesRegex(RTDuplicate, "A roll with this number already exists"):
            api.update(id=self.roll["id"], roll_number=other["roll_number"], remaining_weight=90)
        self.assertEqual(api.get(id=self.roll["id"]), before)
        self.assertEqual(api.movements(roll_id=self.roll["id"])["total"], 3)
        self.assertLedgerAgrees(self.roll["id"])

    def test_untouched_roll_refusal_keeps_its_receipt(self):
        receipt = frappe.db.get_value("Batch", self.roll["id"], "rt_purchase_receipt")
        with self.assertRaisesRegex(RTDuplicate, "A roll with this number already exists"):
            api.update(id=self.roll["id"], roll_number=api.create(**body())["roll_number"],
                       weight=120, remaining_weight=120)
        self.assertEqual(frappe.db.get_value("Batch", self.roll["id"], "rt_purchase_receipt"), receipt)
        self.assertEqual(frappe.db.get_value("Purchase Receipt", receipt, "docstatus"), 1)
        self.assertEqual(api.get(id=self.roll["id"])["weight"], 150)


class TestMovements(PortalRollsCase):
    def setUp(self):
        super().setUp()
        self.running = make_location("RUNNING-1", "Running Godown side 1", "Running Godown", 50)
        self.roll = api.create(**body(weight=150))
        move(self.roll["id"], "OUT", location=self.running, remarks="to line 2")

    def test_newest_first_in_node_shape(self):
        page = api.movements(roll_id=self.roll["id"], pageSize=20)
        self.assertEqual((page["total"], page["page"], page["pageSize"], page["totalPages"]), (2, 1, 20, 1))
        out, received = page["items"]
        self.assertEqual((out["transaction_type"], received["transaction_type"]), ("OUT", "IN"))
        self.assertTrue(MOVEMENT_KEYS <= set(out), MOVEMENT_KEYS - set(out))
        self.assertEqual(out["description"], "Issued out 150 kg to Running Godown side 1")
        self.assertEqual(received["description"], "Received 150 kg")
        self.assertEqual(out["roll_id"], {"id": self.roll["id"], "roll_number": self.roll["roll_number"]})
        self.assertEqual(out["material_id"], self.roll["material_id"])
        self.assertEqual(out["vendor_id"], {"id": self.roll["vendor_id"]["id"], "name": self.roll["vendor_id"]["name"]})
        self.assertEqual(out["to_location"], {"id": self.running, "location_code": "RUNNING-1",
                                              "name": "Running Godown side 1"})
        self.assertEqual(out["from_location"]["id"], self.roll["location"]["id"])
        self.assertIsNone(received["from_location"])
        self.assertEqual((out["weight"], out["used_weight"], out["roll_weight_after"]), (150, None, 150))
        self.assertEqual(out["remarks"], "to line 2")
        self.assertEqual(out["created_by"]["id"], self.admin)
        self.assertRegex(out["transaction_date"], ISO_UTC)
        self.assertEqual(received["transaction_date"], self.roll["date"])
        self.assertRegex(out["createdAt"], ISO_UTC)
        self.assertEqual((out["photo_paths"], out["photo_urls"]), ([], []))

    def test_paging_and_roll_number(self):
        first = api.movements(roll_id=self.roll["id"], pageSize=1)
        self.assertEqual((first["total"], len(first["items"]), first["totalPages"]), (2, 1, 2))
        self.assertEqual(first["items"][0]["transaction_type"], "OUT")
        second = api.movements(roll_id=self.roll["id"], page=2, pageSize=1)
        self.assertEqual(second["items"][0]["transaction_type"], "IN")
        by_number = api.movements(roll_number=self.roll["roll_number"].lower())
        self.assertEqual(by_number["total"], 2)
        self.assertEqual(api.movements(roll_number="no-such-roll")["total"], 0)

    def test_prices_hidden_from_godown_roles(self):
        self.assertIn("rate_per_roll", api.movements(roll_id=self.roll["id"])["items"][0])
        with as_user(self.operator):
            for mv in api.movements(roll_id=self.roll["id"])["items"]:
                self.assertNotIn("rate_per_roll", mv)


class TestRoles(PortalRollsCase):
    def test_godown_roles_read_and_write(self):
        with as_user(self.operator):
            r = api.create(**body())
            api.update(id=r["id"], gsm=95)
            self.assertEqual(api.get(id=r["id"])["gsm"], 95)
            api.search(q=r["roll_number"])
            api.list_rolls(q=r["roll_number"])
            api.movements(roll_id=r["id"])
            api.remove(id=r["id"])

    def test_outsiders_are_refused(self):
        r, fresh = api.create(**body()), body()
        calls = [
            lambda: api.list_rolls(),
            lambda: api.search(),
            lambda: api.get(id=r["id"]),
            lambda: api.create(**fresh),
            lambda: api.update(id=r["id"], gsm=90),
            lambda: api.remove(id=r["id"]),
            lambda: api.movements(roll_id=r["id"]),
        ]
        with as_user(self.outsider):
            for fn in calls:
                with self.assertRaisesRegex(frappe.PermissionError, "You do not have permission to perform this action"):
                    fn()
