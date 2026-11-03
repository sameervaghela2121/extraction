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
    return replay.guarded("Batch", "rt_client_id", data.get("client_id"), lambda: _register(data), roll_dict)


def _register(data: dict) -> dict:
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
        "stock_documents": frappe.as_json([["Purchase Receipt", receipt]]),
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


EDITABLE = {"roll_number", "barcode", "rt_code", "delta_code", "gsm", "width", "lot", "tag_photo", "barcode_photo"}
MAX_REMARK_CODES = 20


def _live_roll(name: str):
    batch = frappe.get_doc("Batch", name) if frappe.db.exists("Batch", name) else None
    if not batch or batch.rt_deleted or not batch.rt_status:
        raise RTNotFound("Roll not found")
    return batch


def update_roll(name: str, changes: dict) -> dict:
    """Correct what was read off the label. Status, weights and location only ever change
    through movements, so a figure never changes without a ledger entry behind it."""
    if not changes:
        raise RTValidation("Provide at least one field to update")
    if "status" in changes:
        raise RTValidation("A roll's status follows its movements — issue or consume it instead")
    if "client_id" in changes:
        raise RTValidation("client_id is set when the roll is created and cannot be changed")
    for key in changes:
        if key not in EDITABLE:
            raise RTValidation(f"{key} cannot be changed here — record a movement instead")
    batch = _live_roll(name)

    roll_number = normalise_code(changes["roll_number"]) if "roll_number" in changes else batch.rt_roll_number
    if not roll_number:
        raise RTValidation("Roll number is required")
    barcode = normalise_code(changes["barcode"]) if "barcode" in changes else batch.rt_barcode
    ensure_codes_free(roll_number, barcode, except_roll=batch.name)
    batch.update({"rt_roll_number": roll_number, "rt_roll_key": roll_number,
                  "rt_barcode": barcode, "rt_barcode_key": barcode})

    if "rt_code" in changes or "delta_code" in changes:
        vendor = frappe.db.get_value("Supplier", batch.rt_vendor, ["name", "supplier_name"], as_dict=True)
        paper = _resolve_paper(vendor, changes.get("rt_code"), changes.get("delta_code"))
        batch.update({"rt_paper_code": paper.get("paper_code") if paper else None,
                      "rt_rt_code": paper.get("rt_code") if paper else None,
                      "rt_delta_code": paper.get("delta_code") if paper else None})
    for field, label in (("gsm", "GSM"), ("width", "Width")):
        if field in changes:
            if flt(changes[field]) <= 0:
                raise RTValidation(f"{label} must be greater than 0")
            batch.set(f"rt_{field}", flt(changes[field]))
    if "lot" in changes:
        if not changes["lot"] or not frappe.db.exists("Roll Lot", changes["lot"]):
            raise RTValidation("That lot no longer exists — pick another")
        batch.rt_lot = changes["lot"]
    for field in ("tag_photo", "barcode_photo"):
        if field in changes:
            batch.set(f"rt_{field}", changes[field])
    batch.flags.ignore_permissions = True
    batch.save()
    return roll_dict(batch.name)


def set_remark_codes(name: str, codes: list[str]) -> dict:
    codes = list(dict.fromkeys(codes or []))
    if len(codes) > MAX_REMARK_CODES:
        raise RTValidation("Too many remark codes")
    if codes and frappe.db.count("RT Remark", {"name": ["in", codes]}) != len(codes):
        raise RTValidation("One or more remarks don't exist")
    batch = _live_roll(name)
    batch.set("rt_remark_codes", [{"remark": c} for c in codes])
    batch.flags.ignore_permissions = True
    batch.save()
    return roll_dict(batch.name)


def delete_roll(name: str) -> dict:
    """Mark the roll and its movements deleted and cancel every stock document they made,
    newest first, so the batch is back to 0. Nothing is erased: a wrong click can be traced
    and undone, and the change reaches every device's next delta pull (modified moves)."""
    batch = _live_roll(name)
    movements = frappe.get_all("Roll Movement", filters={"roll": batch.name, "deleted": 0},
                               fields=["name", "stock_documents"], order_by="creation desc, name desc")
    for mv in movements:
        for doctype, docname in reversed(frappe.parse_json(mv.stock_documents) or []):
            doc = frappe.get_doc(doctype, docname)
            if doc.docstatus == 1:
                doc.flags.ignore_permissions = True
                doc.cancel()
        frappe.db.set_value("Roll Movement", mv.name, "deleted", 1)
    frappe.db.set_value("Batch", batch.name, {"rt_deleted": 1, "rt_roll_key": None, "rt_barcode_key": None})
    return {"name": batch.name, "deleted": True}
