"""The movement engine: one function per movement type, each moving the roll's stock with an
ERPNext document and recording a Roll Movement, in one transaction.

Arithmetic, order of checks and messages follow applyToRoll in
backend/src/services/stock.service.ts: a roll goes OUT whole (no weight changes); its use is
declared when it comes back (RETURN); CONSUME, RETURN_TO_VENDOR and SELL finish it."""

import frappe
from frappe.utils import flt, now_datetime

from royal_touche import replay
from royal_touche.dates import as_system, check_not_future, check_operator_date
from royal_touche.errors import RTConflict, RTValidation
from royal_touche.rolls import find_roll, roll_dict, usable_location
from royal_touche.setup.install import UNASSIGNED_WAREHOUSE
from royal_touche.stock_docs import delivery_note, purchase_return, stock_entry

MOVEMENT_TYPES = ("IN", "OUT", "RETURN", "ADJUSTMENT", "CONSUME", "RETURN_TO_VENDOR", "SELL")
OPERATOR_DATED = {"OUT", "RETURN", "CONSUME", "RETURN_TO_VENDOR", "SELL"}
FINISHED = {"CONSUMED", "RETURNED_TO_VENDOR", "SOLD"}
MAX_PHOTOS = 4
MOVEMENT_FIELDS = (
    "name", "roll", "movement_type", "transaction_date", "recorded_at", "material", "vendor", "weight",
    "used_weight", "roll_weight_after", "issued_to", "from_location", "to_location", "remarks", "remark_code",
    "photos", "buyer", "savio_bill_no", "vehicle_no", "rate_per_roll", "client_id", "deleted",
    "stock_doctype", "stock_docname", "stock_documents", "creation", "modified",
)


def kg(value: float) -> str:
    """150.0 → "150", 80.5 → "80.5": numbers in messages read as the Node ones did."""
    value = flt(value, 3)
    return str(int(value)) if value == int(value) else f"{value:g}"


def record_movement(data: dict) -> dict:
    existing = replay.find("Roll Movement", "client_id", data.get("client_id"))
    if existing:
        return _replayed(existing)
    return replay.guarded("Roll Movement", "client_id", data.get("client_id"), lambda: _record(data), _replayed)


def _replayed(name: str) -> dict:
    mv = movement_dict(name)
    return {"movement": mv, "roll": roll_dict(mv["roll"])}


def _record(data: dict) -> dict:
    mtype = (data.get("movement_type") or "").strip().upper()
    if mtype not in MOVEMENT_TYPES:
        raise RTValidation("transaction_type is required")
    photos = data.get("photos") or []
    if len(photos) > MAX_PHOTOS:
        raise RTValidation(f"At most {MAX_PHOTOS} photos per movement")
    _check_fields(mtype, data)
    when = data.get("transaction_date") or now_datetime()
    if mtype in OPERATOR_DATED:
        check_operator_date(when, data.get("recorded_at"))
    else:
        check_not_future(when)

    roll = frappe.get_doc("Batch", find_roll(data.get("roll") or ""))
    if roll.rt_status == "SOLD" and mtype not in ("CONSUME", "IN"):
        raise RTConflict("This roll has already been sold")

    effect = HANDLERS[mtype](roll, data, when)
    docs = effect.pop("docs", [])
    frappe.db.set_value("Batch", roll.name, effect.pop("roll"))
    mv = frappe.get_doc({
        "doctype": "Roll Movement",
        "roll": roll.name,
        "movement_type": mtype,
        "transaction_date": as_system(when),
        "recorded_at": as_system(data.get("recorded_at") or when),
        "material": roll.item,
        "vendor": roll.rt_vendor,
        "issued_to": data.get("issued_to"),
        "remarks": data.get("remarks"),
        "remark_code": data.get("remark_code"),
        "photos": frappe.as_json(photos) if photos else None,
        "client_id": data.get("client_id") or None,
        "stock_doctype": docs[0][0] if docs else None,
        "stock_docname": docs[0][1] if docs else None,
        "stock_documents": frappe.as_json(docs) if docs else None,
        **effect,
    }).insert(ignore_permissions=True)
    return {"movement": movement_dict(mv.name), "roll": roll_dict(roll.name)}


def movement_dict(name: str) -> dict:
    mv = frappe.db.get_value("Roll Movement", name, MOVEMENT_FIELDS, as_dict=True)
    for field in ("photos", "stock_documents"):
        mv[field] = frappe.parse_json(mv[field]) if mv[field] else []
    return mv


def _check_fields(mtype: str, data: dict) -> None:
    """Shape checks, before any state check — as the Node validator ran before the service."""
    if mtype == "OUT" and not data.get("location"):
        raise RTValidation("Where is the roll going? location is required")
    if mtype == "RETURN" and data.get("returned_weight") is None:
        raise RTValidation("RETURN requires returned_weight — what the roll weighs coming back")
    if mtype == "RETURN" and flt(data["returned_weight"]) < 0:
        raise RTValidation("returned_weight cannot be negative")
    if mtype == "IN" and flt(data.get("weight")) <= 0:
        raise RTValidation("weight is required for IN")
    if mtype == "ADJUSTMENT":
        if data.get("new_weight") is None:
            raise RTValidation("ADJUSTMENT requires new_weight")
        if not (data.get("remarks") or "").strip():
            raise RTValidation("ADJUSTMENT requires remarks")
    if mtype == "SELL" and not data.get("buyer"):
        raise RTValidation("Pick the buyer")


def _where(roll) -> str:
    """The warehouse the roll's stock sits in now."""
    return roll.rt_location or UNASSIGNED_WAREHOUSE


def _out(roll, data, when):
    if roll.rt_status == "ISSUED":
        raise RTConflict("This roll is already out — record its return first")
    remaining = flt(roll.rt_remaining_weight)
    if remaining <= 0:
        raise RTConflict("This roll is empty, there is nothing to take out")
    to = usable_location(data["location"])
    docs = []
    if to != _where(roll):
        docs.append(("Stock Entry", stock_entry("Material Transfer", roll.item, roll.name, remaining, when,
                                                source=_where(roll), target=to)))
    return {"roll": {"rt_status": "ISSUED", "rt_location": to}, "docs": docs,
            "weight": remaining, "roll_weight_after": remaining,
            "from_location": roll.rt_location or None, "to_location": to}


def _return(roll, data, when):
    if roll.rt_status != "ISSUED":
        raise RTConflict("This roll is not currently out, so it cannot be returned")
    on_roll = flt(roll.rt_remaining_weight)
    returned = flt(data["returned_weight"])
    if returned > on_roll:
        raise RTValidation(f"This roll went out with {kg(on_roll)} kg — it cannot come back heavier at {kg(returned)}")
    used = on_roll - returned
    # Back to where it went out from, read off its own OUT row: the operator returning a roll
    # should not have to remember the rack.
    home = frappe.db.get_value(
        "Roll Movement", {"roll": roll.name, "movement_type": "OUT", "deleted": 0}, "from_location",
        order_by="transaction_date desc, creation desc",
    )
    here = _where(roll)
    consumed = returned == 0
    docs = []
    if used > 0:
        docs.append(("Stock Entry", stock_entry("Material Issue", roll.item, roll.name, used, when, source=here)))
    if not consumed and home and home != here:
        docs.append(("Stock Entry", stock_entry("Material Transfer", roll.item, roll.name, returned, when,
                                                source=here, target=home)))
    location = None if consumed else (home or roll.rt_location or None)
    return {"roll": {"rt_status": "CONSUMED" if consumed else "IN_STOCK", "rt_remaining_weight": returned,
                     "rt_location": location},
            "docs": docs, "weight": returned, "used_weight": used, "roll_weight_after": returned,
            "from_location": roll.rt_location or None, "to_location": None if consumed else home}


def _consume(roll, data, when):
    # Already finished: the flag only asserts "this roll is done", which is already true.
    if roll.rt_status in FINISHED:
        return {"roll": {}, "weight": 0, "used_weight": 0, "roll_weight_after": 0,
                "from_location": roll.rt_location or None}
    used = flt(roll.rt_remaining_weight)
    docs = []
    if used > 0:
        docs.append(("Stock Entry", stock_entry("Material Issue", roll.item, roll.name, used, when, source=_where(roll))))
    return {"roll": {"rt_status": "CONSUMED", "rt_remaining_weight": 0, "rt_location": None}, "docs": docs,
            "weight": used, "used_weight": used, "roll_weight_after": 0, "from_location": roll.rt_location or None}


def _return_to_vendor(roll, data, when):
    if roll.rt_status == "ISSUED":
        raise RTConflict("This roll is already out — record its return first")
    if roll.rt_status == "CONSUMED":
        raise RTConflict("This roll is already consumed — there is nothing left to return")
    if roll.rt_status == "RETURNED_TO_VENDOR":
        raise RTConflict("This roll has already been returned to the vendor")
    if not roll.rt_vendor:
        raise RTValidation("This roll has no vendor on record to return it to")
    qty = flt(roll.rt_remaining_weight)
    docs = []
    if qty > 0:
        docs.append(("Purchase Receipt", purchase_return(roll.rt_purchase_receipt, roll.name, qty, _where(roll), when)))
    return {"roll": {"rt_status": "RETURNED_TO_VENDOR", "rt_remaining_weight": 0, "rt_location": None}, "docs": docs,
            "weight": qty, "roll_weight_after": 0, "from_location": roll.rt_location or None}


def _sell(roll, data, when):
    if roll.rt_status == "ISSUED":
        raise RTConflict("This roll is out on production — receive it back before selling it")
    if roll.rt_status == "CONSUMED":
        raise RTConflict("This roll is already consumed — there is nothing left to sell")
    if roll.rt_status == "RETURNED_TO_VENDOR":
        raise RTConflict("This roll has already been returned to the vendor")
    if not frappe.db.exists("Customer", data["buyer"]):
        raise RTValidation("That buyer no longer exists — pick another")
    qty = flt(roll.rt_remaining_weight)
    docs = []
    if qty > 0:
        docs.append(("Delivery Note", delivery_note(data["buyer"], roll.item, roll.name, qty, _where(roll), when,
                                                    rate_per_roll=data.get("rate_per_roll"))))
    return {"roll": {"rt_status": "SOLD", "rt_remaining_weight": 0, "rt_location": None}, "docs": docs,
            "weight": qty, "roll_weight_after": 0, "from_location": roll.rt_location or None,
            "buyer": data["buyer"], "savio_bill_no": (data.get("savio_bill_no") or "").strip() or None,
            "vehicle_no": (data.get("vehicle_no") or "").strip().upper() or None,
            "rate_per_roll": flt(data.get("rate_per_roll")) or None}


def _in(roll, data, when):
    added = flt(data["weight"])
    current = flt(roll.rt_remaining_weight)
    original = flt(roll.rt_original_weight)
    if current + added > original:
        raise RTValidation(f"This roll only ever held {kg(original)} kg — cannot add more than that")
    docs = [("Stock Entry", stock_entry("Material Receipt", roll.item, roll.name, added, when, target=_where(roll)))]
    status = "IN_STOCK" if roll.rt_status in FINISHED else roll.rt_status
    return {"roll": {"rt_status": status, "rt_remaining_weight": current + added}, "docs": docs,
            "weight": added, "roll_weight_after": current + added}


def _adjustment(roll, data, when):
    target = flt(data["new_weight"])
    original = flt(roll.rt_original_weight)
    if target > original:
        raise RTValidation(f"This roll only ever held {kg(original)} kg — the counted amount cannot be higher")
    delta = target - flt(roll.rt_remaining_weight)
    docs = []
    if delta < 0:
        docs.append(("Stock Entry", stock_entry("Material Issue", roll.item, roll.name, -delta, when, source=_where(roll))))
    elif delta > 0:
        docs.append(("Stock Entry", stock_entry("Material Receipt", roll.item, roll.name, delta, when, target=_where(roll))))
    changes = {"rt_remaining_weight": target}
    if target == 0:
        changes.update({"rt_status": "CONSUMED", "rt_location": None})
    return {"roll": changes, "docs": docs, "weight": abs(delta), "roll_weight_after": target}


HANDLERS = {
    "OUT": _out, "RETURN": _return, "CONSUME": _consume, "RETURN_TO_VENDOR": _return_to_vendor,
    "SELL": _sell, "IN": _in, "ADJUSTMENT": _adjustment,
}
