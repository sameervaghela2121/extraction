"""Install-time setup for Royale Touche. Every step is idempotent: `ensure_setup` can run on
every install, migrate or test without creating anything twice."""

import frappe

COMPANY = "Royale Touche"
UNASSIGNED_WAREHOUSE = "Unassigned - RT"
RT_ROLES = ("RT Super Admin", "RT Admin", "Godown Supervisor", "Godown Operator")


def after_install():
    ensure_setup()


def ensure_setup():
    from royal_touche.setup.custom_fields import ensure_custom_fields

    ensure_custom_fields()
    _ensure_roles()
    _ensure_stock_settings()
    _ensure_company()
    _ensure_unassigned_warehouse()


def _ensure_roles():
    for role in RT_ROLES:
        if not frappe.db.exists("Role", role):
            frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def _ensure_stock_settings():
    settings = frappe.get_single("Stock Settings")
    settings.allow_negative_stock = 0
    settings.allow_negative_stock_for_batch = 0
    # Every roll is a batch; ERPNext 16 refuses batch-tracked items until this is on.
    settings.enable_serial_and_batch_no_for_item = 1
    # Each roll is its own batch and keeps its own cost (spec §7). Older sites carry this
    # switch; new ones are batch-wise already.
    if settings.meta.has_field("do_not_use_batchwise_valuation"):
        settings.do_not_use_batchwise_valuation = 0
    settings.save(ignore_permissions=True)


def _ensure_company():
    if not frappe.db.exists("Company", COMPANY):
        # The setup wizard creates it; nothing to do on a site where it has not run yet.
        return
    # Perpetual inventory from day one: at rate 0 its ledger entries are zero, and pricing
    # later needs no switch-over (spec §6).
    if not frappe.db.get_value("Company", COMPANY, "enable_perpetual_inventory"):
        frappe.db.set_value("Company", COMPANY, "enable_perpetual_inventory", 1)


def _ensure_unassigned_warehouse():
    if frappe.db.exists("Warehouse", UNASSIGNED_WAREHOUSE) or not frappe.db.exists("Company", COMPANY):
        return
    frappe.get_doc(
        {"doctype": "Warehouse", "warehouse_name": "Unassigned", "company": COMPANY}
    ).insert(ignore_permissions=True)
