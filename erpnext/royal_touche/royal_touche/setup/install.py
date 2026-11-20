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
    _ensure_uom_kg()
    _ensure_contact_billing_field()
    _ensure_company()
    _ensure_stock_entry_types()
    _ensure_selling_defaults()
    _ensure_fiscal_year()
    _ensure_unassigned_warehouse()
    _ensure_delta_indexes()
    _ensure_unique_barcode_runs()
    _ensure_app_client()
    _ensure_direct_sale_buyer()


def _ensure_uom_kg():
    """Rolls are weighed in Kg. ERPNext's setup wizard normally seeds UOMs; a GCE site
    created without the wizard has an empty UOM table, and Batch insert then fails with
    'Could not find Batch UOM: Kg'."""
    if frappe.db.exists("UOM", "Kg"):
        return
    frappe.get_doc({"doctype": "UOM", "uom_name": "Kg", "enabled": 1}).insert(ignore_permissions=True)


def _ensure_contact_billing_field():
    """ERPNext 16.60 party lookup orders Contact by is_billing_contact. Some Frappe 16.60
    builds ship Contact without that column; Purchase Receipt validate then 1054s and roll
    sync fails after Batch insert. Add a Check custom field so the column exists."""
    if frappe.db.has_column("Contact", "is_billing_contact"):
        return
    if not frappe.db.exists("Custom Field", "Contact-is_billing_contact"):
        frappe.get_doc({
            "doctype": "Custom Field",
            "dt": "Contact",
            "fieldname": "is_billing_contact",
            "label": "Is Billing Contact",
            "fieldtype": "Check",
            "insert_after": "is_primary_contact",
        }).insert(ignore_permissions=True)
    if not frappe.db.has_column("Contact", "is_billing_contact"):
        frappe.db.add_column("Contact", "is_billing_contact", "Int")


def _ensure_direct_sale_buyer():
    # SELL looks up Customer by exact name "Direct Sale". Autoname series would create
    # CUST-YYYY-NNNN and leave SELL failing with "That buyer no longer exists".
    if frappe.db.exists("Customer", DIRECT_SALE_BUYER):
        return
    existing = frappe.db.get_value("Customer", {"customer_name": DIRECT_SALE_BUYER}, "name")
    if existing:
        frappe.rename_doc("Customer", existing, DIRECT_SALE_BUYER, force=True)
        return
    group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
    territory = frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories"
    if not group:
        return  # the setup wizard has not created customer groups yet; the next migrate will
    doc = frappe.get_doc({
        "doctype": "Customer",
        "customer_name": DIRECT_SALE_BUYER,
        "customer_group": group,
        "territory": territory,
    })
    doc.insert(ignore_permissions=True)
    if doc.name != DIRECT_SALE_BUYER:
        frappe.rename_doc("Customer", doc.name, DIRECT_SALE_BUYER, force=True)


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


def _ensure_unique_barcode_runs():
    # on_doctype_update runs only when the doctype itself changes; this reaches existing sites.
    from royal_touche.royal_touche.doctype.barcode_batch.barcode_batch import on_doctype_update

    on_doctype_update()


# A Godown Operator works in the tablet app only, never ERPNext's own screens. ERPNext makes a
# user whose roles have no desk access a Website User: kept out of /app, app login unaffected.
APP_ONLY_ROLES = ("Godown Operator",)


def _ensure_roles():
    for role in RT_ROLES:
        desk = 0 if role in APP_ONLY_ROLES else 1
        if not frappe.db.exists("Role", role):
            frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": desk}).insert(ignore_permissions=True)
        elif frappe.db.get_value("Role", role, "desk_access") != desk:
            doc = frappe.get_doc("Role", role)
            doc.desk_access = desk
            doc.save(ignore_permissions=True)  # ERPNext re-types that role's users on save


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
    # CONSUME / Material Issue needs a Difference Account. Wizard-less sites leave
    # stock_adjustment_account blank and tablet sync then fails mid-movement.
    if not frappe.db.get_value("Company", COMPANY, "stock_adjustment_account"):
        account = frappe.db.get_value(
            "Account",
            {"company": COMPANY, "account_type": "Stock Adjustment", "is_group": 0},
            "name",
        )
        if not account:
            account = frappe.db.get_value(
                "Account",
                {"company": COMPANY, "account_name": "Stock Adjustment", "is_group": 0},
                "name",
            )
        if account:
            frappe.db.set_value("Company", COMPANY, "stock_adjustment_account", account)
    # RETURN_TO_VENDOR (purchase return) and stock valuation need these leaf accounts.
    _set_company_account_if_empty("stock_received_but_not_billed", "Stock Received But Not Billed")
    _set_company_account_if_empty("default_inventory_account", "Stock In Hand", account_type="Stock")
    _set_company_account_if_empty("default_expense_account", "Cost of Goods Sold", account_type="Cost of Goods Sold")


def _set_company_account_if_empty(field: str, account_name: str, account_type: str | None = None) -> None:
    if frappe.db.get_value("Company", COMPANY, field):
        return
    filters = {"company": COMPANY, "is_group": 0}
    if account_type:
        filters["account_type"] = account_type
    else:
        filters["account_name"] = account_name
    account = frappe.db.get_value("Account", filters, "name")
    if not account:
        account = frappe.db.get_value(
            "Account", {"company": COMPANY, "account_name": account_name, "is_group": 0}, "name"
        )
    if account:
        frappe.db.set_value("Company", COMPANY, field, account)


def _ensure_stock_entry_types():
    """ERPNext stock docs reference these by name. A site created without the full
    stock setup has none, so CONSUME / Issue fails with 'Could not find Stock Entry Type'."""
    for name, purpose in (
        ("Material Issue", "Material Issue"),
        ("Material Receipt", "Material Receipt"),
        ("Material Transfer", "Material Transfer"),
    ):
        if frappe.db.exists("Stock Entry Type", name):
            continue
        frappe.get_doc({"doctype": "Stock Entry Type", "name": name, "purpose": purpose}).insert(
            ignore_permissions=True
        )


def _ensure_selling_defaults():
    """SELL posts a Delivery Note; wizard-less sites have no selling price list, so DN
    validation fails on selling_price_list / currency / conversion rate."""
    if not frappe.db.exists("Price List", "Standard Selling"):
        frappe.get_doc({
            "doctype": "Price List",
            "price_list_name": "Standard Selling",
            "selling": 1,
            "buying": 0,
            "currency": frappe.db.get_value("Company", COMPANY, "default_currency") or "INR",
            "enabled": 1,
        }).insert(ignore_permissions=True)
    settings = frappe.get_single("Selling Settings")
    if settings.selling_price_list != "Standard Selling":
        settings.selling_price_list = "Standard Selling"
        settings.save(ignore_permissions=True)


def _ensure_fiscal_year():
    """Purchase Receipt / stock docs require an active Fiscal Year covering posting_date.
    Wizard-less GCE sites have none; roll sync then fails after Batch insert."""
    from frappe.utils import getdate, nowdate

    today = getdate(nowdate())
    year_start = today.replace(month=1, day=1)
    year_end = today.replace(month=12, day=31)
    name = f"{year_start.year}"
    if frappe.db.exists("Fiscal Year", name):
        # Ensure company is linked when the FY already exists from a partial setup.
        fy = frappe.get_doc("Fiscal Year", name)
        if COMPANY and not any(c.company == COMPANY for c in (fy.companies or [])):
            if frappe.db.exists("Company", COMPANY):
                fy.append("companies", {"company": COMPANY})
                fy.save(ignore_permissions=True)
        return
    if not frappe.db.exists("Company", COMPANY):
        return
    # Avoid overlapping with any existing FY that already covers today.
    if frappe.db.sql(
        """select name from `tabFiscal Year`
           where %s between year_start_date and year_end_date limit 1""",
        today,
    ):
        return
    fy = frappe.get_doc({
        "doctype": "Fiscal Year",
        "year": name,
        "year_start_date": year_start,
        "year_end_date": year_end,
        "companies": [{"company": COMPANY}],
    })
    fy.insert(ignore_permissions=True)


def _ensure_unassigned_warehouse():
    if frappe.db.exists("Warehouse", UNASSIGNED_WAREHOUSE) or not frappe.db.exists("Company", COMPANY):
        return
    frappe.get_doc(
        {"doctype": "Warehouse", "warehouse_name": "Unassigned", "company": COMPANY}
    ).insert(ignore_permissions=True)
