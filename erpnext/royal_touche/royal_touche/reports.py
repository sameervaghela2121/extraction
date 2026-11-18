"""The two reports on ERPNext data: reads Roll Movement and Batch into the plain rows the pure
report logic (royal_touche.report_logic, ported from the Node services) works on."""

import frappe
from frappe.utils import flt

from royal_touche.dates import as_ist
from royal_touche.report_logic import consumption, daily_status

MOVEMENT_FIELDS = ["name", "roll", "movement_type", "transaction_date", "creation", "weight", "used_weight",
                   "roll_weight_after", "issued_to", "from_location", "to_location", "deleted", "remarks",
                   "remark_code", "owner", "material"]


def load() -> tuple[list[dict], dict, dict, dict]:
    """(ledger, rolls, locations, remark_labels) in the report logic's contract."""
    names = {}

    def full_name(user):
        if user not in names:
            names[user] = frappe.utils.get_fullname(user)
        return names[user]

    ledger = []
    received = {}
    for m in frappe.get_all("Roll Movement", fields=MOVEMENT_FIELDS, order_by="creation, name"):
        ledger.append({
            "name": m.name, "roll": m.roll, "movement_type": m.movement_type,
            "transaction_date": as_ist(m.transaction_date), "creation": as_ist(m.creation),
            "weight": flt(m.weight),
            "used_weight": flt(m.used_weight) if m.movement_type in ("RETURN", "CONSUME") else None,
            "roll_weight_after": flt(m.roll_weight_after),
            "issued_to": m.issued_to, "from_location": m.from_location, "to_location": m.to_location,
            "deleted": bool(m.deleted), "remarks": m.remarks, "remark_code": m.remark_code,
            "recorded_by": full_name(m.owner), "material": m.material,
        })
        if m.movement_type == "IN" and m.roll not in received:
            received[m.roll] = as_ist(m.transaction_date)

    remark_code_of = dict(frappe.get_all("RT Remark", fields=["name", "remark_code"], as_list=True))
    remark_labels = dict(frappe.get_all("RT Remark", fields=["remark_code", "label"], as_list=True))
    items = {i.name: i for i in frappe.get_all("Item", fields=["name", "item_name"])}
    suppliers = {s.name: s for s in frappe.get_all("Supplier", fields=["name", "supplier_name", "rt_vendor_code"])}
    lots = {lot.name: lot for lot in frappe.get_all("Roll Lot", fields=["name", "document_type", "document_no"])}
    picked = {}
    for link in frappe.get_all("RT Remark Link", filters={"parenttype": "Batch"}, fields=["parent", "remark", "idx"],
                               order_by="parent, idx"):
        picked.setdefault(link.parent, []).append(remark_code_of.get(link.remark))

    rolls = {}
    for b in frappe.get_all("Batch", filters={"rt_status": ["is", "set"]}, fields=[
            "name", "item", "rt_roll_number", "rt_barcode", "rt_vendor", "rt_lot", "rt_paper_code", "rt_rt_code",
            "rt_delta_code", "rt_gsm", "rt_width", "rt_original_weight", "rt_location", "rt_deleted"]):
        item, vendor, lot = items.get(b.item), suppliers.get(b.rt_vendor), lots.get(b.rt_lot)
        rolls[b.name] = {
            "name": b.name, "roll_number": b.rt_roll_number, "barcode": b.rt_barcode,
            "material": b.item, "material_code": b.item, "material_name": item.item_name if item else b.item,
            "vendor": b.rt_vendor, "vendor_name": vendor.supplier_name if vendor else None,
            "vendor_code": vendor.rt_vendor_code if vendor else None,
            "paper_code": b.rt_paper_code, "rt_code": b.rt_rt_code, "delta_code": b.rt_delta_code,
            "gsm": flt(b.rt_gsm), "width": flt(b.rt_width), "weight": flt(b.rt_original_weight), "unit": "kg",
            "lot_document_type": lot.document_type if lot else None, "lot_document_no": lot.document_no if lot else None,
            "received_date": received.get(b.name), "location": b.rt_location or None,
            "remarks": None, "remark_code": None, "remark_codes": [c for c in picked.get(b.name, []) if c],
            "deleted": bool(b.rt_deleted),
        }
    locations = dict(frappe.get_all("Warehouse", fields=["name", "warehouse_name"], as_list=True))
    return ledger, rolls, locations, remark_labels


def consumption_summary(from_day, to_day, group: str = "material") -> dict:
    ledger, rolls, _, _ = load()
    return consumption.summary(ledger, rolls, from_day, to_day, group)


def consumption_summary_csv(from_day, to_day, group: str = "material") -> str:
    ledger, rolls, _, _ = load()
    return consumption.summary_csv(ledger, rolls, from_day, to_day, group)


def consumption_detail(from_day, to_day) -> list[dict]:
    ledger, rolls, locations, _ = load()
    return consumption.detail(ledger, rolls, from_day, to_day, locations)


def consumption_detail_csv(from_day, to_day) -> str:
    ledger, rolls, locations, _ = load()
    return consumption.detail_csv(ledger, rolls, from_day, to_day, locations)


def daily_rows(day) -> list[dict]:
    ledger, rolls, locations, labels = load()
    return daily_status.rows(ledger, rolls, locations, day, labels)


def daily_csv(day) -> str:
    ledger, rolls, locations, labels = load()
    return daily_status.csv(ledger, rolls, locations, day, labels)
