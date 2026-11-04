"""Install-time setup for Royale Touche. Every step is idempotent: `ensure_setup` can run on
every install, migrate or test without creating anything twice."""

import frappe

COMPANY = "Royale Touche"
UNASSIGNED_WAREHOUSE = "Unassigned - RT"
# Sales recorded without a buyer go to this customer: the app's sell dialog has no buyer
# picker (user directive 2026-11-04: the app's screens don't change).
DIRECT_SALE_BUYER = "Direct Sale"
RT_ROLES = ("RT Super Admin", "RT Admin", "Godown Supervisor", "Godown Operator")


def after_install():
    ensure_setup()


def ensure_setup():
    from royal_touche.setup.custom_fields import ensure_custom_fields

    ensure_custom_fields()
    _ensure_roles()
    from royal_touche.setup.permissions import ensure_permissions

    ensure_permissions()
    _ensure_stock_settings()
    _ensure_company()
    _ensure_unassigned_warehouse()
    _ensure_delta_indexes()
    _ensure_app_client()
    _ensure_direct_sale_buyer()


def _ensure_direct_sale_buyer():
    if frappe.db.exists("Customer", DIRECT_SALE_BUYER):
        return
    group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
    territory = frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories"
    if not group:
        return  # the setup wizard has not created customer groups yet; the next migrate will
    frappe.get_doc({"doctype": "Customer", "customer_name": DIRECT_SALE_BUYER, "customer_group": group,
                    "territory": territory}).insert(ignore_permissions=True)


def _ensure_app_client():
    """The OAuth Client the app's login tokens belong to. Tokens are issued by
    royal_touche.api.auth, never through an OAuth sign-in screen, so no redirect is used."""
    from royal_touche.api.auth import APP_CLIENT

    if frappe.db.exists("OAuth Client", {"app_name": APP_CLIENT}):
        return
    frappe.get_doc({
        "doctype": "OAuth Client",
        "app_name": APP_CLIENT,
        "scopes": "all",
        "default_redirect_uri": "https://localhost/unused",
        "redirect_uris": "https://localhost/unused",
        "grant_type": "Authorization Code",
        "response_type": "Code",
        "skip_authorization": 0,
    }).insert(ignore_permissions=True)


# The tablet pulls these by "changed since" (modified, name); ERPNext's own tables have no
# index on modified, ours get one from their sort field.
DELTA_SYNCED = ("Batch", "Supplier", "Item", "Warehouse", "Customer")


def _ensure_delta_indexes():
    for doctype in DELTA_SYNCED:
        frappe.db.add_index(doctype, ["modified", "name"], index_name="rt_modified_name")


def _ensure_roles():
    for role in RT_ROLES:
        if not frappe.db.exists("Role", role):
            frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def _ensure_stock_settings():
    settings = frappe.get_single("Stock Settings")
    settings.allow_negative_stock = 0
    settings.allow_negative_stock_for_batch = 0
    # Otherwise the first priced roll creates an Item Price, and every later unpriced roll or
    # sale of that material silently takes its rate (spec §7: rates are 0 unless given).
    settings.auto_insert_price_list_rate_if_missing = 0
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
