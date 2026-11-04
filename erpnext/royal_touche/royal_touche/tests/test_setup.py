import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.setup.install import UNASSIGNED_WAREHOUSE, ensure_setup

RT_ROLES = ("RT Super Admin", "RT Admin", "Godown Supervisor", "Godown Operator")


class TestSetup(IntegrationTestCase):
    def test_install_is_complete_and_idempotent(self):
        ensure_setup()
        ensure_setup()
        self.assertEqual(frappe.db.get_single_value("Stock Settings", "allow_negative_stock"), 0)
        self.assertEqual(frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item"), 1)
        self.assertEqual(frappe.db.get_single_value("Stock Settings", "allow_negative_stock_for_batch"), 0)
        self.assertEqual(frappe.db.get_single_value("Stock Settings", "auto_insert_price_list_rate_if_missing"), 0)
        self.assertEqual(frappe.db.get_value("Company", "Royale Touche", "abbr"), "RT")
        self.assertTrue(frappe.db.get_value("Company", "Royale Touche", "enable_perpetual_inventory"))
        self.assertEqual(UNASSIGNED_WAREHOUSE, "Unassigned - RT")
        self.assertTrue(frappe.db.exists("Warehouse", UNASSIGNED_WAREHOUSE))
        self.assertEqual(frappe.db.count("Warehouse", {"warehouse_name": "Unassigned"}), 1)
        for role in RT_ROLES:
            self.assertTrue(frappe.db.exists("Role", role), role)
        self.assertTrue(frappe.db.exists("UOM", "Kg"))

    def test_delta_synced_tables_have_a_modified_index(self):
        ensure_setup()
        for doctype in ("Batch", "Supplier", "Item", "Warehouse", "Customer", "Roll Movement", "Roll Lot", "RT Remark"):
            indexed = frappe.db.sql(
                "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() "
                "AND table_name = %s AND column_name = 'modified' AND seq_in_index = 1",
                f"tab{doctype}",
            )
            self.assertTrue(indexed, doctype)
