"""Test helpers: create records the plainest way, so the app's own hooks have to do the rest."""

from contextlib import contextmanager

import frappe

COMPANY = "Royale Touche"

# docs/locations-seed.json
STANDARD_LOCATIONS = [
    ("GODOWN-A-1", "Godown A side 1", "Godown A", 10),
    ("GODOWN-A-2", "Godown A side 2", "Godown A", 20),
    ("GODOWN-B-1", "Godown B side 1", "Godown B", 30),
    ("GODOWN-B-2", "Godown B side 2", "Godown B", 40),
    ("RUNNING-1", "Running Godown side 1", "Running Godown", 50),
    ("RUNNING-2", "Running Godown side 2", "Running Godown", 60),
]


def unique(prefix: str) -> str:
    return f"{prefix}-{frappe.generate_hash(length=6)}"


def make_material(code: str | None = None, name: str | None = None) -> str:
    code = code or unique("MAT")
    doc = frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": code.strip().upper(),
            "item_name": name or code.strip(),
            "item_group": "Raw Material",
            "rt_material_code": code,
        }
    ).insert()
    return doc.name


def make_vendor(code: str | None = None, papers: list[dict] | None = None, name: str | None = None) -> str:
    code = code or unique("V")
    doc = frappe.get_doc(
        {
            "doctype": "Supplier",
            # Suppliers are named after supplier_name, so two test vendors must never share one.
            "supplier_name": name or unique(f"Vendor {code.strip()}"),
            "supplier_group": "All Supplier Groups",
            "rt_vendor_code": code,
            "rt_papers": papers or [],
        }
    ).insert()
    return doc.name


def make_location(code: str | None = None, name: str | None = None, godown: str | None = None, sort_order: int = 0) -> str:
    code = code or unique("LOC")
    existing = frappe.db.get_value("Warehouse", {"rt_location_code": code.strip().upper()})
    if existing:
        return existing
    doc = frappe.get_doc(
        {
            "doctype": "Warehouse",
            "warehouse_name": name or code.strip(),
            "company": COMPANY,
            "rt_location_code": code,
            "rt_godown": godown,
            "rt_sort_order": sort_order,
        }
    ).insert()
    return doc.name


def standard_locations() -> dict[str, str]:
    return {code: make_location(code, name, godown, order) for code, name, godown, order in STANDARD_LOCATIONS}


def make_remark(code: str | None = None, label: str | None = None) -> str:
    code = code or unique("RM")
    doc = frappe.get_doc({"doctype": "RT Remark", "remark_code": code, "label": label or code.strip()}).insert()
    return doc.name


def make_buyer(name: str | None = None) -> str:
    name = name or unique("Buyer")
    existing = frappe.db.get_value("Customer", {"customer_name": name})
    if existing:
        return existing
    group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
    territory = frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories"
    doc = frappe.get_doc(
        {"doctype": "Customer", "customer_name": name, "customer_group": group, "territory": territory}
    ).insert()
    return doc.name


def make_user(role: str) -> str:
    email = f"{frappe.scrub(role)}-{frappe.generate_hash(length=5)}@rt.localhost"
    user = frappe.get_doc(
        {"doctype": "User", "email": email, "first_name": role, "send_welcome_email": 0, "roles": [{"role": role}]}
    ).insert(ignore_permissions=True)
    return user.name


@contextmanager
def as_user(user: str):
    previous = frappe.session.user
    frappe.set_user(user)
    try:
        yield
    finally:
        frappe.set_user(previous)


PAPER = {"paper_code": "55036-29", "rt_code": "868", "delta_code": "D1"}


def today_ist(days_ago: int = 0) -> str:
    from datetime import datetime, timedelta

    from royal_touche.dates import IST

    return (datetime.now(IST) - timedelta(days=days_ago)).date().isoformat()


def make_lot(document_type: str = "challan", document_no: str | None = None, client_id: str | None = None) -> str:
    from royal_touche.lots import create_lot

    return create_lot(
        {"document_type": document_type, "document_no": document_no or unique("DOC"), "client_id": client_id}
    )["name"]


def base_roll(**over) -> dict:
    """A valid registration: fresh material, vendor (with PAPER), lot and location each call."""
    data = {
        "roll_number": unique("R"),
        "barcode": None,
        "lot": make_lot(),
        "vendor": make_vendor(papers=[dict(PAPER)]),
        "material": make_material(),
        "rt_code": PAPER["rt_code"],
        "gsm": 80,
        "width": 1250,
        "weight": 150,
        "location": make_location("GODOWN-A-1", "Godown A side 1", "Godown A", 10),
        "date": today_ist(),
    }
    data.update(over)
    return data


def batch_qty(batch: str, warehouse: str | None = None) -> float:
    from royal_touche.checks import batch_kg

    return batch_kg(batch, warehouse)


def make_file(name: str | None = None) -> str:
    """An image really uploaded to this site; its path is what photo fields hold."""
    import io
    import os

    from PIL import Image

    # Unique content: ERPNext gives files with equal content one shared path.
    buffer = io.BytesIO()
    Image.frombytes("RGB", (4, 4), os.urandom(48)).save(buffer, format="PNG")
    return frappe.get_doc({"doctype": "File", "file_name": name or unique("photo") + ".png", "is_private": 1,
                           "content": buffer.getvalue()}).insert(ignore_permissions=True).file_url
