"""Rolls: one Batch each, received on its own Purchase Receipt, with an IN Roll Movement.

Rules and messages follow backend/src/services/materialRolls.service.ts."""

import frappe
from frappe.utils import flt

from royal_touche import replay
from royal_touche.errors import RTDuplicate, RTNotFound, RTValidation
from royal_touche.masters import normalise_code
from royal_touche.setup.install import UNASSIGNED_WAREHOUSE
from royal_touche.stock_docs import purchase_receipt

ROLL_TAKEN = "A roll with this number already exists"
BARCODE_TAKEN = "A roll with this barcode already exists"


def register_roll(data: dict) -> dict:
    # Replay first, before the uniqueness checks: a retried registration must get its own
    # roll back, not "number already exists" for the roll it created the first time.
    existing = replay.find("Batch", "rt_client_id", data.get("client_id"))
    if existing:
        return roll_dict(existing)

    if not data.get("lot"):
        raise RTValidation("Select the lot (challan or invoice) this roll came in on")
    for field, label in (("weight", "Weight"), ("gsm", "GSM"), ("width", "Width")):
        if flt(data.get(field)) <= 0:
            raise RTValidation(f"{label} must be greater than 0")
    if not frappe.db.exists("Roll Lot", data["lot"]):
        raise RTValidation("That lot no longer exists — pick another")
    material = _usable_material(data.get("material"))
    vendor = _usable_vendor(data.get("vendor"))
    paper = _resolve_paper(vendor, data.get("rt_code"), data.get("delta_code"))
    location = usable_location(data["location"]) if data.get("location") else None

    roll_number = normalise_code(data.get("roll_number"))
    if not roll_number:
        raise RTValidation("Roll number is required")
    barcode = normalise_code(data.get("barcode"))
    ensure_codes_free(roll_number, barcode)

    weight = flt(data["weight"])
    batch = frappe.get_doc({
        "doctype": "Batch",
        "batch_id": frappe.generate_hash(length=10),
        "item": material.name,
        "rt_roll_number": roll_number,
        "rt_barcode": barcode,
        "rt_roll_key": roll_number,
        "rt_barcode_key": barcode,
        "rt_status": "IN_STOCK",
        "rt_original_weight": weight,
        "rt_remaining_weight": weight,
        "rt_location": location,
        "rt_vendor": vendor.name,
        "rt_lot": data["lot"],
        "rt_paper_code": paper.get("paper_code") if paper else None,
        "rt_rt_code": paper.get("rt_code") if paper else None,
        "rt_delta_code": paper.get("delta_code") if paper else None,
        "rt_gsm": flt(data["gsm"]),
        "rt_width": flt(data["width"]),
        "rt_tag_photo": data.get("tag_photo"),
        "rt_barcode_photo": data.get("barcode_photo"),
        "rt_client_id": data.get("client_id") or None,
    })
    batch.flags.ignore_permissions = True
    try:
        batch.insert()
    except frappe.UniqueValidationError as e:
        # Two registrations racing past ensure_codes_free(): the unique index lets one through.
        raise RTDuplicate(BARCODE_TAKEN if "barcode" in str(e) else ROLL_TAKEN) from e

    when = data.get("date") or frappe.utils.now_datetime()
    receipt = purchase_receipt(batch.name, vendor.name, material.name, weight, location or UNASSIGNED_WAREHOUSE,
                               when, rate_per_roll=data.get("rate_per_roll"))
    frappe.db.set_value("Batch", batch.name, "rt_purchase_receipt", receipt, update_modified=False)
    frappe.get_doc({
        "doctype": "Roll Movement",
        "roll": batch.name,
        "movement_type": "IN",
        "transaction_date": when,
        "recorded_at": data.get("recorded_at") or when,
        "material": material.name,
        "vendor": vendor.name,
        "weight": weight,
        "roll_weight_after": weight,
        "to_location": location,
        "remarks": f"Roll {roll_number} received",
        "stock_doctype": "Purchase Receipt",
        "stock_docname": receipt,
    }).insert(ignore_permissions=True)
    return roll_dict(batch.name)


def ensure_codes_free(roll_number: str | None, barcode: str | None, except_roll: str | None = None):
    def taken(field, value):
        other = frappe.db.get_value("Batch", {field: value}, "name") if value else None
        return other and other != except_roll

    if taken("rt_roll_key", roll_number):
        raise RTDuplicate(ROLL_TAKEN)
    if taken("rt_barcode_key", barcode):
        raise RTDuplicate(BARCODE_TAKEN)


def find_roll(id_or_code: str) -> str:
    """A scan gives a barcode, a typed search a roll number, a link an id — any case."""
    code = (id_or_code or "").strip()
    if code:
        for field, value in (("rt_barcode_key", code.upper()), ("rt_roll_key", code.upper())):
            name = frappe.db.get_value("Batch", {field: value}, "name")
            if name:
                return name
        name = frappe.db.get_value("Batch", {"name": code.lower(), "rt_deleted": 0, "rt_status": ["is", "set"]}, "name")
        if name:
            return name
    raise RTNotFound("Roll not found")


def roll_dict(name: str) -> dict:
    b = frappe.get_doc("Batch", name)
    return {
        "name": b.name,
        "roll_number": b.rt_roll_number,
        "barcode": b.rt_barcode,
        "status": b.rt_status,
        "weight": flt(b.rt_original_weight),
        "remaining_weight": flt(b.rt_remaining_weight),
        "location": b.rt_location or None,
        "vendor": b.rt_vendor,
        "material": b.item,
        "lot": b.rt_lot,
        "gsm": flt(b.rt_gsm),
        "width": flt(b.rt_width),
        "paper_code": b.rt_paper_code,
        "rt_code": b.rt_rt_code,
        "delta_code": b.rt_delta_code,
        "remark_codes": [r.remark for r in b.get("rt_remark_codes") or []],
        "tag_photo": b.rt_tag_photo,
        "barcode_photo": b.rt_barcode_photo,
        "client_id": b.rt_client_id,
        "deleted": bool(b.rt_deleted),
        "modified": str(b.modified),
    }


def usable_location(name: str) -> str:
    w = frappe.db.get_value("Warehouse", name, ["name", "warehouse_name", "disabled"], as_dict=True)
    if not w:
        raise RTValidation("That location no longer exists — pick another")
    if w.disabled:
        raise RTValidation(f"{w.warehouse_name} is inactive — pick a different location")
    return w.name


def _usable_material(name: str | None):
    m = frappe.db.get_value("Item", name, ["name", "item_name", "disabled"], as_dict=True) if name else None
    if not m:
        raise RTValidation("That material no longer exists — pick another")
    if m.disabled:
        raise RTValidation(f"{m.item_name} is inactive — reactivate it before booking stock against it")
    return m


def _usable_vendor(name: str | None):
    v = frappe.db.get_value("Supplier", name, ["name", "supplier_name", "disabled"], as_dict=True) if name else None
    if not v:
        raise RTValidation("That vendor no longer exists — pick another")
    if v.disabled:
        raise RTValidation(f"{v.supplier_name} is inactive — pick a different vendor")
    return v


def _resolve_paper(vendor, rt_code: str | None, delta_code: str | None) -> dict | None:
    """The vendor's own copy of the picked paper — found by RT code, or by Delta code when
    there is none. A paper the vendor doesn't have is refused."""
    if not rt_code and not delta_code:
        return None
    papers = frappe.get_all("Vendor Paper", filters={"parent": vendor.name, "parenttype": "Supplier"},
                            fields=["paper_code", "rt_code", "delta_code"])
    if rt_code:
        match = next((p for p in papers if (p.rt_code or "").upper() == rt_code.strip().upper()), None)
        label = f"RT {rt_code}"
    else:
        match = next((p for p in papers if (p.delta_code or "").upper() == delta_code.strip().upper()), None)
        label = f"Delta {delta_code}"
    if not match:
        raise RTValidation(f"Paper {label} is not one of {vendor.supplier_name}'s papers")
    return dict(match)
