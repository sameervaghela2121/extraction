"""The portal's lots, barcode label runs and APK link (royal_touche.api.portal_lots), checked
against what the old Node server answered (backend/src/services/{lots,barcodeBatches}.service.ts,
backend/src/controllers/app.controller.ts)."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.api import portal_lots as api
from royal_touche.rolls import register_roll
from royal_touche.tests.factories import as_user, base_roll, make_file, make_user, make_vendor, unique

ISO_UTC = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
LOT_KEYS = {"id", "document_type", "document_no", "document_photo_path", "document_photo_url", "client_id",
            "created_by", "createdAt", "updatedAt"}
BATCH_KEYS = {"id", "prefix", "date", "from_number", "to_number", "kind", "widthMm", "heightMm", "count",
              "createdBy", "createdAt"}


def run(**over) -> dict:
    body = {"prefix": unique("P")[-6:].replace("-", ""), "date": "2026-11-03", "from_number": 1, "to_number": 3,
            "kind": "barcode", "widthMm": 100, "heightMm": 50}
    body.update(over)
    return api.create_barcode_batch(**body)


class PortalLotsCase(IntegrationTestCase):
    def setUp(self):
        self.admin = make_user("RT Admin")
        self.operator = make_user("Godown Operator")
        self.outsider = make_user("Accounts User")
        frappe.set_user(self.admin)

    def tearDown(self):
        frappe.set_user("Administrator")


class TestLots(PortalLotsCase):
    def test_create_returns_the_old_shape(self):
        lot = api.create_lot(document_type="challan", document_no=" 4587 ")
        self.assertEqual(set(lot), LOT_KEYS)
        self.assertEqual((lot["document_type"], lot["document_no"]), ("challan", "4587"))
        self.assertIsNone(lot["document_photo_path"])
        self.assertIsNone(lot["document_photo_url"])
        self.assertEqual(lot["created_by"], self.admin)
        self.assertRegex(lot["createdAt"], ISO_UTC)
        self.assertRegex(lot["updatedAt"], ISO_UTC)

    def test_photo_path_is_stored_and_read_back(self):
        path = make_file()
        lot = api.create_lot(document_type="invoice", document_no=unique("INV"), document_photo_path=path)
        self.assertEqual(lot["document_photo_path"], path)
        self.assertEqual(api.get_lot(lot["id"])["document_photo_path"], path)
        self.assertEqual(frappe.db.get_value("File", {"file_url": path}, "attached_to_name"), lot["id"])

    def test_photo_must_be_an_uploaded_file(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Photos must be files uploaded to this server"):
            api.create_lot(document_type="invoice", document_no="1", document_photo_path="https://evil/x.png")

    def test_validation_messages(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Pick challan or invoice"):
            api.create_lot(document_type="bill", document_no="1")
        with self.assertRaisesRegex(frappe.ValidationError, "Challan or invoice number is required"):
            api.create_lot(document_type="challan", document_no="  ")

    def test_same_client_id_returns_the_first_lot(self):
        cid = str(frappe.generate_hash(length=12))
        a = api.create_lot(document_type="challan", document_no="A", client_id=cid)
        b = api.create_lot(document_type="challan", document_no="B", client_id=cid)
        self.assertEqual(a["id"], b["id"])

    def test_get_missing_lot_is_404(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Lot not found") as ctx:
            api.get_lot("nope")
        self.assertEqual(ctx.exception.http_status_code, 404)

    def test_list_newest_first_paged_and_searched(self):
        tag = unique("LQ")
        names = [api.create_lot(document_type="challan", document_no=f"{tag}-{i}")["id"] for i in range(3)]
        api.create_lot(document_type="challan", document_no=unique("OTHER"))
        page1 = api.list_lots(q=tag.lower(), page=1, pageSize=2)
        self.assertEqual({k: page1[k] for k in ("total", "page", "pageSize", "totalPages")},
                         {"total": 3, "page": 1, "pageSize": 2, "totalPages": 2})
        self.assertEqual([r["id"] for r in page1["items"]], names[::-1][:2])
        self.assertEqual([r["id"] for r in api.list_lots(q=tag, page=2, pageSize=2)["items"]], names[:1])
        # The list carries no photo URL; only the detail does.
        self.assertTrue(all(r["document_photo_url"] is None and set(r) == LOT_KEYS for r in page1["items"]))

    def test_list_search_is_literal(self):
        tag = unique("LIT")
        api.create_lot(document_type="challan", document_no=f"{tag}_A")
        api.create_lot(document_type="challan", document_no=f"{tag}XA")
        self.assertEqual(api.list_lots(q=f"{tag}_A")["total"], 1)
        self.assertEqual(api.list_lots(q=f"{tag}%")["total"], 0)

    def test_empty_list_reads_as_page_one_of_one(self):
        self.assertEqual(api.list_lots(q=unique("NONE"))["totalPages"], 1)

    def test_list_defaults_to_50_and_allows_200(self):
        self.assertEqual(api.list_lots()["pageSize"], 50)
        self.assertEqual(api.list_lots(pageSize=200)["pageSize"], 200)

    def test_roles(self):
        with as_user(self.operator):
            lot = api.create_lot(document_type="challan", document_no=unique("OP"))
            api.get_lot(lot["id"])
            api.list_lots()
        with as_user(self.outsider):
            for call in (lambda: api.list_lots(), lambda: api.get_lot(lot["id"]),
                         lambda: api.create_lot(document_type="challan", document_no="X")):
                with self.assertRaises(frappe.PermissionError):
                    call()


class TestBarcodeRuns(PortalLotsCase):
    def test_create_returns_the_old_shape(self):
        b = run(prefix=" rt ", from_number=1, to_number=10, kind="qr", widthMm=40, heightMm=40)
        self.assertEqual(set(b), BATCH_KEYS)
        self.assertEqual((b["prefix"], b["date"], b["from_number"], b["to_number"], b["count"], b["kind"]),
                         ("RT", "2026-11-03", 1, 10, 10, "qr"))
        self.assertEqual(b["createdBy"], frappe.utils.get_fullname(self.admin))
        self.assertRegex(b["createdAt"], ISO_UTC)
        self.assertEqual((b["widthMm"], b["heightMm"]), (40, 40))

    def test_size_is_stored_not_the_kind_default(self):
        b = run(from_number=500, to_number=510, kind="barcode", widthMm=60, heightMm=30)
        self.assertEqual((b["widthMm"], b["heightMm"]), (60, 30))
        self.assertEqual(frappe.db.get_value("Barcode Batch", b["id"], ["width_mm", "height_mm"]), (60, 30))

    def test_create_validation_messages(self):
        cases = [
            ({"prefix": "  "}, "Enter the letters the code starts with"),
            ({"prefix": "ABCDEFGHIJKLM"}, "prefix: String must contain at most 12 character"),
            ({"date": ""}, "Pick a date"),
            ({"date": "03/11/2026"}, r"Pick a date \(YYYY-MM-DD\)"),
            ({"from_number": -1}, "from_number: Number must be greater than or equal to 0"),
            ({"to_number": 1.5}, "to_number: Expected integer"),
            ({"kind": "pdf"}, "kind: Invalid enum value"),
            ({"widthMm": 0}, "widthMm: Number must be greater than 0"),
            ({"heightMm": 501}, "heightMm: Number must be less than or equal to 500"),
            ({"from_number": 5, "to_number": 4}, "The end number is lower than the start number"),
            ({"from_number": 1, "to_number": 501}, "That's 501 labels — 500 at a time is the limit"),
        ]
        for over, message in cases:
            with self.subTest(over=over), self.assertRaisesRegex(frappe.ValidationError, message) as ctx:
                run(**over)
            self.assertEqual(ctx.exception.http_status_code, 400)

    def test_same_run_twice_is_409(self):
        b = run(prefix="DUPRUN")
        with self.assertRaisesRegex(frappe.ValidationError, "That exact run has already been saved") as ctx:
            run(prefix="duprun", kind="qr")
        self.assertEqual(ctx.exception.http_status_code, 409)
        api.remove_barcode_batch(b["id"])
        with self.assertRaisesRegex(frappe.ValidationError, "That exact run has already been saved"):
            run(prefix="DUPRUN")

    def test_two_saves_racing_past_the_checks_meet_the_unique_index(self):
        """Both checks read before either insert lands (a locking read finds no row to lock); the
        database's unique (prefix, date, from_number, to_number) is what stops the second."""
        first = run(prefix="RACE", from_number=7, to_number=9)
        get_value, exists = frappe.db.get_value, frappe.db.exists

        def unseen_get_value(doctype, *args, **kwargs):
            return None if doctype == "Barcode Batch" and kwargs.get("for_update") else get_value(doctype, *args, **kwargs)

        def unseen_exists(doctype, *args, **kwargs):
            return None if doctype == "Barcode Batch" else exists(doctype, *args, **kwargs)

        frappe.clear_messages()
        with patch.object(frappe.db, "get_value", side_effect=unseen_get_value), \
                patch.object(frappe.db, "exists", side_effect=unseen_exists), \
                self.assertRaisesRegex(frappe.ValidationError, "That exact run has already been saved") as ctx:
            run(prefix="RACE", from_number=7, to_number=9, kind="qr")
        self.assertEqual(ctx.exception.http_status_code, 409)
        self.assertEqual(frappe.get_all("Barcode Batch", {"prefix": "RACE", "date": "2026-11-03", "from_number": 7},
                                        pluck="name"), [first["id"]])
        # Only this message reaches the portal, not ERPNext's own "... must be unique" as well.
        shown = [m.get("message") if isinstance(m, dict) else frappe.parse_json(m).get("message")
                 for m in frappe.local.message_log]
        self.assertEqual(shown, ["That exact run has already been saved"])
        frappe.clear_messages()

    def test_next_number(self):
        self.assertEqual(api.barcode_next_number(prefix="NNX", date="2026-11-03"), {"next": 1})
        run(prefix="NNX", from_number=1, to_number=10)
        self.assertEqual(api.barcode_next_number(prefix=" nnx ", date="2026-11-03"), {"next": 11})
        self.assertEqual(api.barcode_next_number(prefix="NNX", date="2026-11-04"), {"next": 1})
        self.assertEqual(api.barcode_next_number(prefix="NNX", date=""), {"next": 1})
        with self.assertRaisesRegex(frappe.ValidationError, "Date must be YYYY-MM-DD"):
            api.barcode_next_number(prefix="NNX", date="3/11/2026")

    def test_remove_is_soft_and_numbers_stay_spent(self):
        b = run(prefix="SOFT", from_number=1, to_number=20)
        self.assertEqual(api.remove_barcode_batch(b["id"]), {"id": b["id"]})
        self.assertEqual(frappe.db.get_value("Barcode Batch", b["id"], "deleted"), 1)
        self.assertNotIn(b["id"], [r["id"] for r in api.list_barcode_batches(pageSize=100)["items"]])
        self.assertEqual(api.barcode_next_number(prefix="SOFT", date="2026-11-03"), {"next": 21})
        self.assertEqual(api.remove_barcode_batch(b["id"]), {"id": b["id"]})  # again: still fine
        with self.assertRaisesRegex(frappe.ValidationError, "Barcode batch not found") as ctx:
            api.remove_barcode_batch("nope")
        self.assertEqual(ctx.exception.http_status_code, 404)

    def test_list_newest_first_and_paged(self):
        a, b = run(), run()
        page = api.list_barcode_batches(page=1, pageSize=2)
        self.assertEqual([r["id"] for r in page["items"]], [b["id"], a["id"]])
        self.assertEqual((page["page"], page["pageSize"]), (1, 2))
        self.assertEqual(page["total"], frappe.db.count("Barcode Batch", {"deleted": 0}))
        self.assertEqual(api.list_barcode_batches()["pageSize"], 20)

    def test_search_partial_code_gives_single_stickers(self):
        b = run(prefix="SRCHA", from_number=1, to_number=12)
        hits = api.search_barcodes(q="srcha26110301")["items"]
        self.assertEqual([h["code"] for h in hits], [f"SRCHA261103{n:03d}" for n in range(10, 13)])
        self.assertTrue(all(h["batch"]["id"] == b["id"] and "roll" not in h for h in hits))
        self.assertEqual(set(hits[0]["batch"]), BATCH_KEYS)

    def test_search_caps_at_50_and_hides_deleted(self):
        b = run(prefix="SRCHB", from_number=1, to_number=80)
        self.assertEqual(len(api.search_barcodes(q="SRCHB")["items"]), 50)
        api.remove_barcode_batch(b["id"])
        self.assertEqual(api.search_barcodes(q="SRCHB")["items"], [])
        self.assertEqual(api.search_barcodes(q="   ")["items"], [])

    def test_search_through_a_roll(self):
        b = run(prefix="SRCHC", from_number=1, to_number=5)
        rt = unique("RTC")
        paper = {"paper_code": unique("PC"), "rt_code": rt, "delta_code": unique("DC")}
        with as_user("Administrator"):
            roll = register_roll(base_roll(barcode="srchc261103004", roll_number=unique("AJ"),
                                           vendor=make_vendor(papers=[paper]), rt_code=rt))
        rt = frappe.db.get_value("Batch", roll["name"], "rt_rt_code")
        for q in (roll["roll_number"], roll["roll_number"].lower()[-4:]):
            hits = [h for h in api.search_barcodes(q=q)["items"] if h.get("roll")]
            self.assertEqual(len(hits), 1, q)
            self.assertEqual(hits[0]["code"], "SRCHC261103004")
            self.assertEqual(hits[0]["batch"]["id"], b["id"])
            self.assertEqual(hits[0]["roll"]["roll_number"], roll["roll_number"])
            self.assertEqual(hits[0]["roll"]["royal_touche_code"], rt)
        for code in (rt, paper["delta_code"]):
            hits = [h for h in api.search_barcodes(q=code)["items"] if h.get("roll")]
            self.assertEqual([h["roll"]["roll_number"] for h in hits], [roll["roll_number"]], code)
            self.assertEqual(hits[0]["roll"].get("delta_code"), paper["delta_code"].upper())
        # A removed roll no longer holds its label.
        frappe.db.set_value("Batch", roll["name"], "rt_deleted", 1)
        self.assertEqual([h for h in api.search_barcodes(q=roll["roll_number"])["items"] if h.get("roll")], [])
        # Reached both as a code and through its roll, it shows once.
        self.assertEqual([h["code"] for h in api.search_barcodes(q="SRCHC261103004")["items"]], ["SRCHC261103004"])

    def test_roles(self):
        with as_user(self.operator):
            b = run()
            api.list_barcode_batches()
            api.search_barcodes(q="X")
            api.barcode_next_number(prefix="X", date="2026-11-03")
            api.remove_barcode_batch(b["id"])
        with as_user(self.outsider):
            for call in (lambda: run(), lambda: api.list_barcode_batches(), lambda: api.search_barcodes(q="X"),
                         lambda: api.barcode_next_number(prefix="X", date="2026-11-03"),
                         lambda: api.remove_barcode_batch(b["id"])):
                with self.assertRaises(frappe.PermissionError):
                    call()


class TestApk(PortalLotsCase):
    def test_url_from_site_config(self):
        with patch.dict(frappe.conf, {"rt_apk_url": "https://example.com/app.apk"}):
            self.assertEqual(api.apk_url(), {"url": "https://example.com/app.apk"})
            with as_user(self.operator):
                api.apk_url()
            with as_user(self.outsider), self.assertRaises(frappe.PermissionError):
                api.apk_url()

    def test_no_build_is_404(self):
        with patch.dict(frappe.conf, {"rt_apk_url": None}):
            with self.assertRaisesRegex(frappe.ValidationError, "No app build has been uploaded yet") as ctx:
                api.apk_url()
        self.assertEqual(ctx.exception.http_status_code, 404)
