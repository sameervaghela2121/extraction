import json
import tempfile
from pathlib import Path

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.setup import dev_seed

VENDORS = [
    {"vendor_code": "SEEDV-1", "name": "Seed Vendor One",
     "papers": [{"royal_touche_code": "868", "delta_code": "d1", "supplier_code_number": "55036-29", "found_in": "1mm"},
                {"royal_touche_code": "869", "supplier_code_number": "55036-30"}]},
    {"vendor_code": "SEEDV-2", "name": "Seed Vendor Two", "papers": []},
]
LOCATIONS = [{"location_code": "SEED-RACK-1", "name": "Seed rack 1", "godown": "Seed Godown", "sort_order": 10}]
REMARKS = [{"remark_code": "SEED-DEFECT", "label": "Seed defect", "sort_order": 1}]


class TestDevSeed(IntegrationTestCase):
    def setUp(self):
        self.docs = Path(tempfile.mkdtemp())
        for name, rows in (("vendors-seed.json", VENDORS), ("locations-seed.json", LOCATIONS), ("remarks-seed.json", REMARKS)):
            (self.docs / name).write_text(json.dumps(rows))
        self.users_file = self.docs / "dev-users"
        frappe.conf.developer_mode = 1
        self.addCleanup(setattr, frappe.conf, "developer_mode", frappe.conf.get("developer_mode"))

    def load(self):
        return dev_seed.load(str(self.docs), users_file=str(self.users_file))

    def test_loads_everything_once(self):
        first = self.load()
        self.assertEqual((first["vendors"], first["papers"], first["locations"], first["remarks"]), (2, 2, 1, 1))
        self.assertEqual((first["materials"], first["buyers"], first["users"]), (3, 1, 4))
        again = self.load()
        self.assertEqual(again, first)
        self.assertEqual(frappe.db.count("Supplier", {"rt_vendor_code": "SEEDV-1"}), 1)

    def test_papers_and_codes(self):
        self.load()
        vendor = frappe.get_doc("Supplier", {"rt_vendor_code": "SEEDV-1"})
        p = vendor.rt_papers[0]
        self.assertEqual((p.rt_code, p.delta_code, p.paper_code, p.found_in), ("868", "D1", "55036-29", "1mm"))
        self.assertEqual(frappe.db.get_value("Warehouse", {"rt_location_code": "SEED-RACK-1"}, "rt_godown"), "Seed Godown")
        for code in ("BASE-PAPER", "TISSUE", "BARRIER"):
            self.assertTrue(frappe.db.exists("Item", {"rt_material_code": code}), code)
        self.assertTrue(frappe.db.exists("Customer", "Walk-in Buyer"))

    def test_one_user_per_role_with_passwords_kept_private(self):
        from frappe.utils.password import check_password

        self.load()
        saved = json.loads(self.users_file.read_text())
        self.assertEqual(sorted(saved), sorted(dev_seed.DEV_USERS))
        self.assertEqual(self.users_file.stat().st_mode & 0o777, 0o600)
        for email, role in dev_seed.DEV_USERS.items():
            self.assertIn(role, frappe.get_roles(email))
            check_password(email, saved[email])

    def test_refuses_without_developer_mode(self):
        frappe.conf.developer_mode = 0
        with self.assertRaisesRegex(frappe.ValidationError, "only runs on a development site"):
            self.load()
