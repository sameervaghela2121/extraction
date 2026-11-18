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
        from royal_touche.setup.install import DIRECT_SALE_BUYER

        self.assertEqual(DIRECT_SALE_BUYER, "Direct Sale")
        self.assertTrue(frappe.db.exists("Customer", DIRECT_SALE_BUYER))
        self.assertEqual(frappe.db.count("Customer", {"customer_name": "Direct Sale"}), 1)

    def test_delta_synced_tables_have_a_modified_index(self):
        ensure_setup()
        for doctype in ("Batch", "Supplier", "Item", "Warehouse", "Customer", "Roll Movement", "Roll Lot", "RT Remark"):
            indexed = frappe.db.sql(
                "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() "
                "AND table_name = %s AND column_name = 'modified' AND seq_in_index = 1",
                f"tab{doctype}",
            )
            self.assertTrue(indexed, doctype)

    def test_operators_use_the_app_only(self):
        """A Godown Operator works in the tablet app, not ERPNext's own screens: the role has no
        desk access, so ERPNext makes such users Website Users (app login still works)."""
        from royal_touche.tests.factories import make_user

        ensure_setup()
        self.assertEqual(frappe.db.get_value("Role", "Godown Operator", "desk_access"), 0)
        for role in ("Godown Supervisor", "RT Admin", "RT Super Admin"):
            self.assertEqual(frappe.db.get_value("Role", role, "desk_access"), 1, role)
        self.assertEqual(frappe.db.get_value("User", make_user("Godown Operator"), "user_type"), "Website User")
        self.assertEqual(frappe.db.get_value("User", make_user("Godown Supervisor"), "user_type"), "System User")
