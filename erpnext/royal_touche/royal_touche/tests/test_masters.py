import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.masters import normalise_code
from royal_touche.tests.factories import make_material, make_remark, make_vendor


class TestMasters(IntegrationTestCase):
    def test_normalise_code(self):
        self.assertEqual(normalise_code("  ab-1 "), "AB-1")
        self.assertIsNone(normalise_code("   "))
        self.assertIsNone(normalise_code(None))

    def test_vendor_code_stored_upper_case_and_trimmed(self):
        v = make_vendor(code="  v-low ")
        self.assertEqual(frappe.db.get_value("Supplier", v, "rt_vendor_code"), "V-LOW")

    def test_vendor_code_unique_ignoring_case(self):
        make_vendor(code="DUP1")
        with self.assertRaises(frappe.UniqueValidationError):
            make_vendor(code="dup1")

    def test_paper_codes_upper_case(self):
        v = make_vendor(code="V2", papers=[{"paper_code": "ab-1", "rt_code": "868", "delta_code": "d9"}])
        p = frappe.get_doc("Supplier", v).rt_papers[0]
        self.assertEqual((p.paper_code, p.rt_code, p.delta_code), ("AB-1", "868", "D9"))

    def test_material_is_kg_batch_tracked_stock_item(self):
        item = frappe.get_doc("Item", make_material("tissue-x"))
        self.assertEqual(item.rt_material_code, "TISSUE-X")
        self.assertEqual((item.stock_uom, item.has_batch_no, item.is_stock_item, item.create_new_batch), ("Kg", 1, 1, 0))

    def test_remark_code_unique_and_upper_case(self):
        r = make_remark(code=" defect-x ")
        self.assertEqual(frappe.db.get_value("RT Remark", r, "remark_code"), "DEFECT-X")
        with self.assertRaises(frappe.UniqueValidationError):
            make_remark(code="Defect-X")

    def test_disabled_remark_stays_readable(self):
        r = make_remark()
        frappe.db.set_value("RT Remark", r, "disabled", 1)
        self.assertEqual(frappe.db.get_value("RT Remark", r, "disabled"), 1)
