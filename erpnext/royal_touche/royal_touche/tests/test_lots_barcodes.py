import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.barcodes import codes_of, next_number
from royal_touche.lots import create_lot


def make_batch(prefix="RT", date="2026-11-03", from_number=1, to_number=3, deleted=0):
    return frappe.get_doc(
        {
            "doctype": "Barcode Batch",
            "prefix": prefix,
            "date": date,
            "from_number": from_number,
            "to_number": to_number,
            "deleted": deleted,
        }
    ).insert().name


class TestLots(IntegrationTestCase):
    def test_create_lot(self):
        lot = create_lot({"document_type": "challan", "document_no": " 4587 "})
        self.assertEqual((lot["document_type"], lot["document_no"]), ("challan", "4587"))
        self.assertEqual(lot["name"], lot["name"].lower())

    def test_document_type_must_be_challan_or_invoice(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Pick challan or invoice"):
            create_lot({"document_type": "bill", "document_no": "1"})

    def test_document_no_required_and_at_most_100(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Challan or invoice number is required"):
            create_lot({"document_type": "invoice", "document_no": "   "})
        with self.assertRaises(frappe.ValidationError):
            create_lot({"document_type": "invoice", "document_no": "9" * 101})

    def test_same_client_id_returns_the_first_lot(self):
        cid = frappe.generate_hash(length=12)
        a = create_lot({"document_type": "invoice", "document_no": "1881", "client_id": cid})
        b = create_lot({"document_type": "challan", "document_no": "OTHER", "client_id": cid})
        self.assertEqual(a["name"], b["name"])
        self.assertEqual(frappe.db.count("Roll Lot", {"client_id": cid}), 1)


class TestBarcodeBatches(IntegrationTestCase):
    def test_next_number_starts_at_one(self):
        self.assertEqual(next_number("ZZ", "2026-11-03"), 1)

    def test_next_number_follows_the_highest_run_including_deleted(self):
        make_batch(prefix="NX", from_number=1, to_number=10)
        make_batch(prefix="NX", from_number=11, to_number=20, deleted=1)
        self.assertEqual(next_number(" nx ", "2026-11-03"), 21)

    def test_codes_are_padded_to_at_least_three_digits(self):
        b = make_batch(prefix="rt", from_number=1, to_number=3)
        self.assertEqual(codes_of(b), ["RT261103001", "RT261103002", "RT261103003"])

    def test_width_follows_the_largest_number(self):
        b = make_batch(prefix="WD", from_number=998, to_number=1001)
        self.assertEqual(codes_of(b)[0], "WD2611030998")

    def test_end_before_start_rejected(self):
        with self.assertRaisesRegex(frappe.ValidationError, "The end number is lower than the start number"):
            make_batch(prefix="BAD", from_number=5, to_number=4)

    def test_at_most_500_labels(self):
        with self.assertRaisesRegex(frappe.ValidationError, "That's 501 labels — 500 at a time is the limit"):
            make_batch(prefix="BIG", from_number=1, to_number=501)

    def test_same_run_twice_rejected(self):
        make_batch(prefix="TW", from_number=1, to_number=5)
        with self.assertRaisesRegex(frappe.ValidationError, "That exact run has already been saved"):
            make_batch(prefix="tw", from_number=1, to_number=5)
