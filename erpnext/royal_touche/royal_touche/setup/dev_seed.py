"""Test data for a development site: the masters from the repo's seed files, three materials,
a buyer, and one login per role. Never for production: refuses unless developer_mode is on.

    bench --site rt.localhost execute royal_touche.setup.dev_seed.load \\
        --kwargs "{'repo_docs': '/path/to/extraction/docs'}"

Passwords go to ~/.config/rt-erpnext/dev-users (mode 600), never to the output."""

import json
import os
import secrets
from pathlib import Path

import frappe

from royal_touche.setup.install import COMPANY

MATERIALS = (("BASE-PAPER", "Base paper"), ("TISSUE", "Tissue"), ("BARRIER", "Barrier"))
BUYER = "Walk-in Buyer"
# rt-* addresses: the setup wizard already made admin@rt.localhost, the site's own administrator.
DEV_USERS = {
    "rt-operator@rt.localhost": "Godown Operator",
    "rt-supervisor@rt.localhost": "Godown Supervisor",
    "rt-admin@rt.localhost": "RT Admin",
    "rt-superadmin@rt.localhost": "RT Super Admin",
}
USERS_FILE = "~/.config/rt-erpnext/dev-users"


def load(repo_docs: str, users_file: str = USERS_FILE) -> dict:
    if not frappe.conf.get("developer_mode"):
        frappe.throw("The dev seed only runs on a development site (developer_mode is off)")
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
            frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": name, "item_group": "Raw Material",
                            "rt_material_code": code}).insert(ignore_permissions=True)

    if not frappe.db.exists("Customer", BUYER):
        frappe.get_doc({"doctype": "Customer", "customer_name": BUYER,
                        "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                        "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories",
                        }).insert(ignore_permissions=True)

    _users(Path(os.path.expanduser(users_file)))
    vendor_names = [frappe.db.get_value("Supplier", {"rt_vendor_code": v["vendor_code"].strip().upper()}) for v in vendors]
    return {
        "vendors": len(vendor_names),
        "papers": frappe.db.count("Vendor Paper", {"parenttype": "Supplier", "parent": ["in", vendor_names or [""]]}),
        "locations": frappe.db.count("Warehouse", {"rt_location_code": ["in", [l["location_code"].strip().upper() for l in locations] or [""]]}),
        "remarks": frappe.db.count("RT Remark", {"remark_code": ["in", [r["remark_code"].strip().upper() for r in remarks] or [""]]}),
        "materials": frappe.db.count("Item", {"rt_material_code": ["in", [c for c, _ in MATERIALS]]}),
        "buyers": 1 if frappe.db.exists("Customer", BUYER) else 0,
        "users": sum(1 for email in DEV_USERS if frappe.db.exists("User", email)),
    }


def _users(path: Path) -> None:
    from frappe.utils.password import update_password

    saved = json.loads(path.read_text()) if path.exists() else {}
    for email, role in DEV_USERS.items():
        if not frappe.db.exists("User", email):
            frappe.get_doc({"doctype": "User", "email": email, "first_name": role, "send_welcome_email": 0,
                            "roles": [{"role": role}]}).insert(ignore_permissions=True)
        elif role not in frappe.get_roles(email):
            frappe.get_doc("User", email).add_roles(role)
        saved.setdefault(email, secrets.token_urlsafe(12))
        update_password(email, saved[email])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(json.dumps(saved, indent=1))
