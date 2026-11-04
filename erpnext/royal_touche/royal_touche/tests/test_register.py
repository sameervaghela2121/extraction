import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.errors import RTDuplicate, RTValidation
from royal_touche.rolls import find_roll, register_roll
from royal_touche.setup.install import UNASSIGNED_WAREHOUSE
from royal_touche.tests.factories import base_roll, batch_qty, make_vendor


class TestRegister(IntegrationTestCase):
    def test_register_creates_batch_receipt_and_in_movement(self):
        r = register_roll(base_roll(roll_number="r-100x", barcode="rt261103901", weight=150))
        self.assertEqual((r["roll_number"], r["barcode"], r["status"]), ("R-100X", "RT261103901", "IN_STOCK"))
        self.assertEqual((r["weight"], r["remaining_weight"]), (150, 150))
        self.assertEqual((r["paper_code"], r["rt_code"], r["delta_code"]), ("55036-29", "868", "D1"))
        self.assertEqual(r["name"], r["name"].lower())
        pr = frappe.get_doc("Purchase Receipt", frappe.db.get_value("Batch", r["name"], "rt_purchase_receipt"))
        self.assertEqual(pr.docstatus, 1)
        self.assertEqual(pr.items[0].qty, 150)
        self.assertEqual(pr.supplier, r["vendor"])
        mv = frappe.get_all("Roll Movement", {"roll": r["name"]}, ["movement_type", "weight", "stock_docname", "stock_documents"])
        self.assertEqual(len(mv), 1)
        self.assertEqual((mv[0].movement_type, mv[0].weight, mv[0].stock_docname), ("IN", 150, pr.name))
        self.assertEqual(frappe.parse_json(mv[0].stock_documents), [["Purchase Receipt", pr.name]])
        self.assertEqual(batch_qty(r["name"], r["location"]), 150)

    def test_lot_is_required(self):
        with self.assertRaisesRegex(RTValidation, r"Select the lot \(challan or invoice\) this roll came in on"):
            register_roll(base_roll(lot=None))

    def test_roll_number_unique_ignoring_case(self):
        register_roll(base_roll(roll_number="DUPROLL"))
        with self.assertRaisesRegex(RTDuplicate, "A roll with this number already exists"):
            register_roll(base_roll(roll_number="duproll"))

    def test_barcode_unique_ignoring_case_and_found_by_lowercase_scan(self):
        r = register_roll(base_roll(barcode="RT261103950"))
        with self.assertRaisesRegex(RTDuplicate, "A roll with this barcode already exists"):
            register_roll(base_roll(barcode="rt261103950"))
        self.assertEqual(find_roll("rt261103950"), r["name"])
        self.assertEqual(find_roll(r["roll_number"].lower()), r["name"])
        self.assertEqual(find_roll(r["name"].upper()), r["name"])

    def test_same_client_id_returns_the_first_roll(self):
        cid = frappe.generate_hash(length=16)
        a = register_roll(base_roll(client_id=cid))
        b = register_roll(base_roll(client_id=cid))
        self.assertEqual(a["name"], b["name"])
        self.assertEqual(frappe.db.count("Batch", {"rt_client_id": cid}), 1)
        self.assertEqual(frappe.db.count("Roll Movement", {"roll": a["name"]}), 1)

    def test_no_location_goes_to_unassigned_and_reads_empty(self):
        r = register_roll(base_roll(location=None))
        self.assertIsNone(r["location"])
        self.assertEqual(batch_qty(r["name"], UNASSIGNED_WAREHOUSE), 150)

    def test_inactive_material_rejected(self):
        data = base_roll()
        frappe.db.set_value("Item", data["material"], "disabled", 1)
        name = frappe.db.get_value("Item", data["material"], "item_name")
        with self.assertRaisesRegex(RTValidation, f"{name} is inactive — reactivate it before booking stock against it"):
            register_roll(data)

    def test_inactive_vendor_rejected(self):
        data = base_roll()
        frappe.db.set_value("Supplier", data["vendor"], "disabled", 1)
        name = frappe.db.get_value("Supplier", data["vendor"], "supplier_name")
        with self.assertRaisesRegex(RTValidation, f"{name} is inactive — pick a different vendor"):
            register_roll(data)

    def test_paper_must_belong_to_vendor(self):
        data = base_roll(rt_code="999")
        name = frappe.db.get_value("Supplier", data["vendor"], "supplier_name")
        with self.assertRaisesRegex(RTValidation, f"Paper RT 999 is not one of {name}'s papers"):
            register_roll(data)
        data = base_roll(rt_code=None, delta_code="zz")
        name = frappe.db.get_value("Supplier", data["vendor"], "supplier_name")
        with self.assertRaisesRegex(RTValidation, f"Paper Delta zz is not one of {name}'s papers"):
            register_roll(data)

    def test_paper_found_by_delta_when_no_rt(self):
        r = register_roll(base_roll(rt_code=None, delta_code="d1"))
        self.assertEqual(r["rt_code"], "868")

    def test_weight_gsm_width_must_be_positive(self):
        for field, label in (("weight", "Weight"), ("gsm", "GSM"), ("width", "Width")):
            with self.assertRaisesRegex(RTValidation, f"{label} must be greater than 0"):
                register_roll(base_roll(**{field: 0}))

    def test_device_times_with_a_zone_are_stored_as_india_time(self):
        r = register_roll(base_roll(date="2026-11-02", recorded_at="2026-11-02T02:40:00Z"))
        mv = frappe.get_all("Roll Movement", {"roll": r["name"]}, ["transaction_date", "recorded_at"])[0]
        self.assertEqual(str(mv.recorded_at), "2026-11-02 08:10:00")
        self.assertEqual(str(mv.transaction_date), "2026-11-02 00:00:00")

    def test_batch_uses_batchwise_valuation(self):
        r = register_roll(base_roll())
        self.assertEqual(frappe.db.get_value("Batch", r["name"], "use_batchwise_valuation"), 1)

    def test_registration_photos_are_kept_and_shown_on_the_in_entry(self):
        """As Node did: the roll keeps all four photos, and the IN row carries the ones taken
        (registrationPhotos in materialRolls.service.ts), so any user sees them in history."""
        r = register_roll(base_roll(tag_photo="/private/files/tag.jpg", side1_photo="/private/files/side1.jpg",
                                    side2_photo="/private/files/side2.jpg"))
        self.assertEqual((r["tag_photo"], r["barcode_photo"], r["side1_photo"], r["side2_photo"]),
                         ("/private/files/tag.jpg", None, "/private/files/side1.jpg", "/private/files/side2.jpg"))
        photos = frappe.get_value("Roll Movement", {"roll": r["name"], "movement_type": "IN"}, "photos")
        self.assertEqual(frappe.parse_json(photos),
                         ["/private/files/tag.jpg", "/private/files/side1.jpg", "/private/files/side2.jpg"])

    def test_no_registration_photos_means_none_on_the_in_entry(self):
        r = register_roll(base_roll())
        self.assertIsNone(frappe.get_value("Roll Movement", {"roll": r["name"], "movement_type": "IN"}, "photos"))
