"""Test data for a development site: the masters from the repo's seed files, three materials,
a buyer, and one login per role. Never for production: refuses unless developer_mode is on.

    bench --site rt.localhost execute royal_touche.setup.dev_seed.load \\
        --kwargs "{'repo_docs': '/path/to/extraction/docs'}"

Every test user's password is DEV_PASSWORD: a development site only, never production."""

import json
from pathlib import Path

import frappe

from royal_touche.setup.install import COMPANY

MATERIALS = (("BASE-PAPER", "Base paper"), ("TISSUE", "Tissue"), ("BARRIER", "Barrier"))
BUYER = "Walk-in Buyer"
DEV_USERS = {
    "operator1@gmail.com": "Godown Operator",
    "supervisor1@gmail.com": "Godown Supervisor",
    "admin1@gmail.com": "RT Admin",
    "superadmin1@gmail.com": "RT Super Admin",
}
DEV_PASSWORD = "Admin@123"


def _allow_dev_seed() -> bool:
    """Local sites use developer_mode; GCE Dev uses rt_environment=development."""
    return bool(frappe.conf.get("developer_mode")) or frappe.conf.get("rt_environment") == "development"


def _ensure_seed_masters() -> None:
    """Leaf masters the ERPNext wizard normally creates; required before Items/Customers."""
    if not frappe.db.exists("Item Group", "Raw Material"):
        parent = "All Item Groups" if frappe.db.exists("Item Group", "All Item Groups") else None
        doc = frappe.get_doc({"doctype": "Item Group", "item_group_name": "Raw Material", "is_group": 0})
        if parent:
            doc.parent_item_group = parent
        doc.insert(ignore_permissions=True)

    if not frappe.db.exists("Customer Group", {"is_group": 0}):
        parent = "All Customer Groups" if frappe.db.exists("Customer Group", "All Customer Groups") else None
        doc = frappe.get_doc(
            {"doctype": "Customer Group", "customer_group_name": "Commercial", "is_group": 0}
        )
        if parent:
            doc.parent_customer_group = parent
        doc.insert(ignore_permissions=True)

    if not frappe.db.exists("Territory", {"is_group": 0}):
        parent = "All Territories" if frappe.db.exists("Territory", "All Territories") else None
        doc = frappe.get_doc({"doctype": "Territory", "territory_name": "India", "is_group": 0})
        if parent:
            doc.parent_territory = parent
        doc.insert(ignore_permissions=True)

    if not frappe.db.exists("Supplier Group", {"is_group": 0}):
        parent = "All Supplier Groups" if frappe.db.exists("Supplier Group", "All Supplier Groups") else None
        doc = frappe.get_doc(
            {"doctype": "Supplier Group", "supplier_group_name": "Local", "is_group": 0}
        )
        if parent:
            doc.parent_supplier_group = parent
        doc.insert(ignore_permissions=True)

    if not frappe.db.exists("Company", COMPANY):
        frappe.get_doc(
            {
                "doctype": "Company",
                "company_name": COMPANY,
                "abbr": "RT",
                "default_currency": "INR",
                "country": "India",
                "enable_perpetual_inventory": 1,
            }
        ).insert(ignore_permissions=True)


def load(repo_docs: str) -> dict:
    if not _allow_dev_seed():
        frappe.throw(
            "The dev seed only runs on a development site "
            "(developer_mode or rt_environment=development)"
        )
    _ensure_seed_masters()
    docs = Path(repo_docs)
    vendors = json.loads((docs / "vendors-seed.json").read_text())
    locations = json.loads((docs / "locations-seed.json").read_text())
    remarks = json.loads((docs / "remarks-seed.json").read_text())

    for v in vendors:
        papers = [{"rt_code": p.get("royal_touche_code"), "delta_code": p.get("delta_code"),
                   "paper_code": p.get("supplier_code_number"), "found_in": p.get("found_in"),
                   "is_common": 1 if p.get("is_common") else 0} for p in v.get("papers") or []]
        name = frappe.db.get_value("Supplier", {"rt_vendor_code": v["vendor_code"].strip().upper()})
        doc = frappe.get_doc("Supplier", name) if name else frappe.get_doc({
            "doctype": "Supplier", "supplier_name": v["name"], "rt_vendor_code": v["vendor_code"],
            "supplier_group": frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups"})
        doc.set("rt_papers", papers)
        doc.save(ignore_permissions=True) if name else doc.insert(ignore_permissions=True)

    for loc in locations:
        if not frappe.db.exists("Warehouse", {"rt_location_code": loc["location_code"].strip().upper()}):
            frappe.get_doc({"doctype": "Warehouse", "warehouse_name": loc["name"], "company": COMPANY,
                            "rt_location_code": loc["location_code"], "rt_godown": loc.get("godown"),
                            "rt_sort_order": loc.get("sort_order") or 0}).insert(ignore_permissions=True)

    for r in remarks:
        if not frappe.db.exists("RT Remark", {"remark_code": r["remark_code"].strip().upper()}):
            frappe.get_doc({"doctype": "RT Remark", "remark_code": r["remark_code"], "label": r["label"],
                            "sort_order": r.get("sort_order") or 0}).insert(ignore_permissions=True)

    for code, name in MATERIALS:
        if not frappe.db.exists("Item", {"rt_material_code": code}):
            frappe.get_doc({
                "doctype": "Item", "item_code": code, "item_name": name,
                "item_group": "Raw Material", "rt_material_code": code,
                "stock_uom": "Kg", "is_stock_item": 1, "has_batch_no": 1, "create_new_batch": 0,
            }).insert(ignore_permissions=True)
        else:
            # Sites seeded before UOM Kg existed may still have a blank/wrong stock_uom.
            item_name = frappe.db.get_value("Item", {"rt_material_code": code}, "name")
            if item_name and frappe.db.get_value("Item", item_name, "stock_uom") != "Kg":
                doc = frappe.get_doc("Item", item_name)
                doc.stock_uom = "Kg"
                doc.is_stock_item = 1
                doc.has_batch_no = 1
                doc.create_new_batch = 0
                doc.save(ignore_permissions=True)

    if not frappe.db.exists("Customer", {"customer_name": BUYER}):
        frappe.get_doc({"doctype": "Customer", "customer_name": BUYER,
                        "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                        "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories",
                        }).insert(ignore_permissions=True)

    _users()
    vendor_names = [frappe.db.get_value("Supplier", {"rt_vendor_code": v["vendor_code"].strip().upper()}) for v in vendors]
    return {
        "vendors": len(vendor_names),
        "papers": frappe.db.count("Vendor Paper", {"parenttype": "Supplier", "parent": ["in", vendor_names or [""]]}),
        "locations": frappe.db.count("Warehouse", {"rt_location_code": ["in", [l["location_code"].strip().upper() for l in locations] or [""]]}),
        "remarks": frappe.db.count("RT Remark", {"remark_code": ["in", [r["remark_code"].strip().upper() for r in remarks] or [""]]}),
        "materials": frappe.db.count("Item", {"rt_material_code": ["in", [c for c, _ in MATERIALS]]}),
        "buyers": 1 if frappe.db.exists("Customer", {"customer_name": BUYER}) else 0,
        "users": sum(1 for email in DEV_USERS if frappe.db.exists("User", email)),
    }


def _users() -> None:
    from frappe.utils.password import update_password

    for email, role in DEV_USERS.items():
        if not frappe.db.exists("User", email):
            frappe.get_doc({"doctype": "User", "email": email, "first_name": role, "send_welcome_email": 0,
                            "roles": [{"role": role}]}).insert(ignore_permissions=True)
        elif role not in frappe.get_roles(email):
            frappe.get_doc("User", email).add_roles(role)
        update_password(email, DEV_PASSWORD)
