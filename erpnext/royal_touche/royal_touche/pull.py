"""One delta pull for every record kind the tablet keeps.

Rows come in (modified, name) order and each page continues strictly after the last row of the
previous one, so rows sharing a modified time are never skipped or repeated across a page
boundary. Disabled masters and deleted rolls/movements come back flagged: the tablet removes or
greys them out itself."""

import frappe
from frappe.utils import cint

from royal_touche.errors import RTValidation
from royal_touche.lots import lot_dict
from royal_touche.masters import vendor_dict
from royal_touche.movements import movement_dict
from royal_touche.rolls import roll_dict
from royal_touche.setup.install import COMPANY

KINDS = ("materials", "vendors", "locations", "remarks", "buyers", "lots", "rolls", "movements")
MAX_LIMIT = 500

# kind → (doctype, extra SQL condition on the doctype's own columns)
SOURCES = {
    "materials": ("Item", "`rt_material_code` IS NOT NULL AND `rt_material_code` != ''"),
    "vendors": ("Supplier", "`rt_vendor_code` IS NOT NULL AND `rt_vendor_code` != ''"),
    "locations": ("Warehouse", "`is_group` = 0 AND `company` = %(company)s "
                               "AND `rt_location_code` IS NOT NULL AND `rt_location_code` != ''"),
    "remarks": ("RT Remark", "1 = 1"),
    "buyers": ("Customer", "1 = 1"),
    "lots": ("Roll Lot", "1 = 1"),
    "rolls": ("Batch", "`rt_status` IS NOT NULL AND `rt_status` != ''"),
    "movements": ("Roll Movement", "1 = 1"),
}


def changes(kind: str, after: str | None, after_name: str | None, limit: int = 200) -> dict:
    if kind not in SOURCES:
        raise RTValidation(f"Unknown kind: {kind}")
    doctype, condition = SOURCES[kind]
    limit = max(1, min(cint(limit) or 200, MAX_LIMIT))
    keyset = ""
    if after:
        keyset = "AND (`modified` > %(after)s OR (`modified` = %(after)s AND `name` > %(after_name)s))"
    rows = frappe.db.sql(
        f"SELECT `name`, `modified` FROM `tab{doctype}` WHERE {condition} {keyset} "
        f"ORDER BY `modified` ASC, `name` ASC LIMIT %(limit)s",
        {"after": after, "after_name": after_name or "", "limit": limit, "company": COMPANY},
        as_dict=True,
    )
    items = [_shape(kind, r.name) for r in rows]
    last = rows[-1] if len(rows) == limit else None
    return {"items": items, "next": {"after": str(last.modified), "after_name": last.name} if last else None}


def _shape(kind: str, name: str) -> dict:
    if kind == "vendors":
        return vendor_dict(name)
    if kind == "lots":
        return lot_dict(name)
    if kind == "rolls":
        roll = roll_dict(name)
        lot = frappe.db.get_value("Roll Lot", roll["lot"], ["document_type", "document_no"], as_dict=True) if roll["lot"] else None
        return {**roll, "lot_document_type": lot.document_type if lot else None,
                "lot_document_no": lot.document_no if lot else None}
    if kind == "movements":
        mv = movement_dict(name)
        return {**mv, "roll_number": frappe.db.get_value("Batch", mv["roll"], "rt_roll_number")}
    if kind == "materials":
        d = frappe.db.get_value("Item", name, ["name", "rt_material_code", "item_name", "disabled", "rt_sort_order",
                                               "modified"], as_dict=True)
        return {"name": d.name, "material_code": d.rt_material_code, "item_name": d.item_name,
                "disabled": cint(d.disabled), "sort_order": cint(d.rt_sort_order), "modified": str(d.modified)}
    if kind == "locations":
        d = frappe.db.get_value("Warehouse", name, ["name", "rt_location_code", "warehouse_name", "rt_godown",
                                                    "rt_sort_order", "disabled", "modified"], as_dict=True)
        return {"name": d.name, "location_code": d.rt_location_code, "warehouse_name": d.warehouse_name,
                "godown": d.rt_godown, "sort_order": cint(d.rt_sort_order), "disabled": cint(d.disabled),
                "modified": str(d.modified)}
    if kind == "remarks":
        d = frappe.db.get_value("RT Remark", name, ["name", "remark_code", "label", "sort_order", "disabled", "modified"],
                                as_dict=True)
        return {**d, "sort_order": cint(d.sort_order), "disabled": cint(d.disabled), "modified": str(d.modified)}
    d = frappe.db.get_value("Customer", name, ["name", "customer_name", "disabled", "modified"], as_dict=True)
    return {**d, "disabled": cint(d.disabled), "modified": str(d.modified)}
