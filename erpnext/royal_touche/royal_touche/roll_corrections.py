"""Correcting a roll's weight, material and location from the portal.

A roll that has not moved yet (its one live movement is the IN it was registered with) was
registered wrong, so its registration is corrected: the receipt is cancelled and replaced by
one with the right weight, material and location, against the same Batch, and the IN row and
the roll are corrected in place. Nothing new appears in its history.

A roll that has moved has a history that has to keep adding up, so its ledger explains every
change from here on: a new remaining weight is an ADJUSTMENT movement, a new location a
Material Transfer of what it holds. Its material and arrival weight are locked.

Everything is checked before anything is written, and the writes run in a savepoint, so a
refused correction leaves nothing behind."""

from contextlib import contextmanager

import frappe
from frappe.utils import flt, get_datetime, now_datetime

from royal_touche.errors import RTValidation
from royal_touche.movements import FINISHED, kg, record_movement
from royal_touche.rolls import _live_roll, _usable_material, roll_dict, usable_location
from royal_touche.setup.install import UNASSIGNED_WAREHOUSE
from royal_touche.stock_docs import cancel, ledger_time, purchase_receipt, stock_entry

CORRECTABLE = ("weight", "remaining_weight", "material", "location")
ADJUSTMENT_REMARKS = "Corrected on the portal"
UNMOVED_WEIGHTS = ("This roll hasn't moved yet, so it still holds what arrived on it — "
                   "weight and remaining weight must be the same")
MATERIAL_LOCKED = "Material can't be changed after the roll has moved"
WEIGHT_LOCKED = "Weight is locked once the roll has moved"
NO_STOCK = "This roll holds no stock in a godown, so its location can't be changed"
OUT_ON_FLOOR = "This roll is out — record its return before changing its location"
FINISHED_WEIGHT = "This roll is finished, so its remaining weight can no longer be corrected"
NO_LOCATION = "That location no longer exists — pick another"
NO_MATERIAL = "That material no longer exists — pick another"


def correct_roll(name: str, changes: dict) -> dict:
    """changes: any of weight, remaining_weight, material, location. A field equal to what the
    roll already has is ignored."""
    with atomic():
        apply_correction(plan_correction(name, changes))
    return roll_dict(name)


@contextmanager
def atomic():
    """All or nothing: a refusal part-way through undoes what was already written."""
    savepoint = f"rt_correct_{frappe.generate_hash(length=8)}"
    frappe.db.savepoint(savepoint)
    try:
        yield
    except Exception as error:
        try:
            frappe.db.rollback(save_point=savepoint)
        except Exception:
            raise error from None  # a deadlock already ended the transaction, savepoint included
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def plan_correction(name: str, changes: dict) -> dict:
    """Check the whole correction against the roll as it stands; write nothing. Returns what
    apply_correction needs."""
    if not changes:
        raise RTValidation("Provide at least one field to update")
    for key in changes:
        if key not in CORRECTABLE:
            raise RTValidation(f"{key} cannot be corrected here")
    # Two corrections of one roll at once would both read, and replace, the same receipt; a
    # tablet movement of it (movements._record) takes the same lock. The roll is read with the
    # lock: a plain read after it would still see this transaction's older snapshot.
    frappe.db.get_value("Batch", name, "name", for_update=True)
    roll = _live_roll(name, for_update=True)
    arrival = _registration(roll)
    plan = {"roll": roll.name, "unmoved": arrival is not None, "arrival": arrival}

    if "material" in changes:
        material = _rt_material(changes["material"]) if changes["material"] != roll.item else None
        if material:
            plan["material"] = material
    if "location" in changes and (not changes["location"] or changes["location"] != roll.rt_location):
        plan["location"] = _rt_location(changes["location"])

    weight = _number(changes, "weight", "Weight")
    remaining = _number(changes, "remaining_weight", "Remaining weight")
    if plan["unmoved"]:
        _plan_unmoved(roll, plan, weight, remaining)
    else:
        _plan_moved(roll, plan, weight, remaining)
    return plan


def _plan_unmoved(roll, plan, weight, remaining):
    if weight is None and remaining is None:
        return
    weight = flt(roll.rt_original_weight) if weight is None else weight
    remaining = flt(roll.rt_remaining_weight) if remaining is None else remaining
    if weight != remaining:
        raise RTValidation(UNMOVED_WEIGHTS)
    if weight <= 0:
        raise RTValidation("Weight must be greater than 0")
    if weight != flt(roll.rt_original_weight):
        plan["weight"] = weight


def _plan_moved(roll, plan, weight, remaining):
    if plan.get("material"):
        raise RTValidation(MATERIAL_LOCKED)
    if weight is not None and weight != flt(roll.rt_original_weight):
        raise RTValidation(WEIGHT_LOCKED)
    held = flt(roll.rt_remaining_weight)
    if remaining is not None and remaining != held:
        if roll.rt_status in FINISHED:
            raise RTValidation(FINISHED_WEIGHT)
        if remaining < 0:
            raise RTValidation("Remaining weight cannot be negative")
        original = flt(roll.rt_original_weight)
        if remaining > original:
            # The ADJUSTMENT's own refusal, checked here so nothing is written first.
            raise RTValidation(f"This roll only ever held {kg(original)} kg — the counted amount cannot be higher")
        plan["remaining_weight"] = held = remaining
    if plan.get("location"):
        if roll.rt_status == "ISSUED":
            raise RTValidation(OUT_ON_FLOOR)
        if roll.rt_status != "IN_STOCK" or held <= 0:
            raise RTValidation(NO_STOCK)


def apply_correction(plan: dict) -> None:
    if plan["unmoved"]:
        if {"weight", "material", "location"} & set(plan):
            _reregister(plan)
        return
    if "remaining_weight" in plan:
        record_movement({"movement_type": "ADJUSTMENT", "roll": plan["roll"], "new_weight": plan["remaining_weight"],
                         "remarks": ADJUSTMENT_REMARKS, "transaction_date": now_datetime()})
    if "location" in plan:
        _relocate(plan["roll"], plan["location"])


def _registration(roll) -> dict | None:
    """The roll's IN row and its receipt while that is all that has happened to it; else None."""
    movements = frappe.get_all("Roll Movement", filters={"roll": roll.name, "deleted": 0},
                               fields=["name", "movement_type", "stock_doctype", "stock_docname"], limit=2)
    if len(movements) != 1:
        return None
    (mv,) = movements
    receipt = roll.rt_purchase_receipt
    if (mv.movement_type != "IN" or mv.stock_doctype != "Purchase Receipt" or mv.stock_docname != receipt
            or roll.rt_status != "IN_STOCK"
            or frappe.db.get_value("Purchase Receipt", receipt, "docstatus") != 1):
        return None
    return {"movement": mv.name, "receipt": receipt}


def _reregister(plan: dict) -> None:
    """Replace the roll's receipt with one carrying the corrected figures, same Batch, same
    posting time, same price; then correct the roll and its IN row to match."""
    roll = frappe.db.get_value("Batch", plan["roll"], ["name", "item", "rt_original_weight", "rt_location"],
                               as_dict=True)
    old = frappe.get_doc("Purchase Receipt", plan["arrival"]["receipt"])
    item = plan.get("material") or roll.item
    weight = plan.get("weight") or flt(roll.rt_original_weight)
    location = plan["location"] if "location" in plan else roll.rt_location
    posted = get_datetime(f"{old.posting_date} {old.posting_time}")

    cancel("Purchase Receipt", old.name)
    if item != roll.item:
        # ERPNext locks a Batch's item only on its form. With the receipt cancelled the batch
        # holds nothing, so it follows the corrected material and keeps its name.
        batch = frappe.get_doc("Batch", roll.name)
        batch.item = item
        batch.flags.ignore_permissions = True
        batch.save()
    # The price as it was given at registration; the old receipt's amount is ERPNext's rounded
    # per-kg rate times the weight, and reused it would drift with every correction. Rolls
    # registered before the IN row kept the price fall back to that amount, once: it is kept
    # on the IN row from here on.
    price = flt(frappe.db.get_value("Roll Movement", plan["arrival"]["movement"], "rate_per_roll"))
    price = price or flt(old.items[0].amount) or None
    receipt = purchase_receipt(roll.name, old.supplier, item, weight, location or UNASSIGNED_WAREHOUSE, posted,
                               rate_per_roll=price, amended_from=old.name)
    frappe.db.set_value("Batch", roll.name, {"rt_original_weight": weight, "rt_remaining_weight": weight,
                                             "rt_location": location, "rt_purchase_receipt": receipt})
    frappe.db.set_value("Roll Movement", plan["arrival"]["movement"], {
        "material": item, "weight": weight, "roll_weight_after": weight, "to_location": location, "rate_per_roll": flt(price),
        "stock_doctype": "Purchase Receipt", "stock_docname": receipt,
        "stock_documents": frappe.as_json([["Purchase Receipt", receipt]]),
    })


def _relocate(name: str, location: str) -> None:
    """Move what the roll holds to the corrected location. No history row: the roll did not
    move, its location was recorded wrong. The transfer is listed with the newest movement's
    stock documents, so deleting the roll cancels it first, in ledger order."""
    roll = frappe.get_doc("Batch", name)
    posted_at = ledger_time(roll.rt_last_posted, now_datetime())
    entry = stock_entry("Material Transfer", roll.item, roll.name, flt(roll.rt_remaining_weight), posted_at,
                        source=roll.rt_location or UNASSIGNED_WAREHOUSE, target=location)
    frappe.db.set_value("Batch", roll.name, {"rt_location": location, "rt_last_posted": posted_at})
    newest = frappe.get_all("Roll Movement", filters={"roll": roll.name, "deleted": 0},
                            fields=["name", "stock_documents"], order_by="creation desc, name desc", limit=1)[0]
    docs = frappe.parse_json(newest.stock_documents) or []
    docs.append(["Stock Entry", entry])
    frappe.db.set_value("Roll Movement", newest.name, "stock_documents", frappe.as_json(docs), update_modified=False)


def _number(changes: dict, field: str, label: str) -> float | None:
    if field not in changes:
        return None
    value = changes[field]
    if isinstance(value, bool):
        raise RTValidation(f"{label} must be a number")
    try:
        return flt(float(value), 3)
    except (TypeError, ValueError):
        raise RTValidation(f"{label} must be a number") from None


def _rt_location(name) -> str:
    if not name or not frappe.db.get_value("Warehouse", name, "rt_location_code"):
        raise RTValidation(NO_LOCATION)
    return usable_location(name)


def _rt_material(name) -> str:
    if not name or not frappe.db.get_value("Item", name, "rt_material_code"):
        raise RTValidation(NO_MATERIAL)
    return _usable_material(name).name
