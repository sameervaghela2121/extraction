"""Replays a seed fixture (tests/fixtures/*.json, from `npm run seed:export`) through the real
business actions — register_roll, record_movement, set_remark_codes, delete_roll — in the
seed's write order, stamping each record's creation at the time the seed saved it.

Test-only: the today-or-yesterday rule is lifted, since the seed months are in the past."""

import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import frappe

from royal_touche.dates import as_ist, as_system
from royal_touche.lots import create_lot
from royal_touche.movements import record_movement
from royal_touche.rolls import delete_roll, register_roll, set_remark_codes
from royal_touche.tests.factories import COMPANY, make_buyer

# The display names the pure report tests use for the seed's two locations.
LOCATION_NAMES = {"SEED-LOC-1": "Seed Godown", "SEED-LOC-2": "Seed Floor"}


def _masters(data: dict) -> tuple[dict, dict]:
    for m in data["masters"]["materials"]:
        code = m["material_code"]
        if not frappe.db.exists("Item", code):
            frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": m.get("name") or code,
                            "item_group": "Raw Material", "rt_material_code": code}).insert()
    vendors = {}
    for v in data["masters"]["vendors"]:
        doc = frappe.get_doc({"doctype": "Supplier", "supplier_name": v["name"], "supplier_group": "All Supplier Groups",
                              "rt_vendor_code": v["vendor_code"], "rt_papers": v["papers"]}).insert()
        vendors[v["vendor_code"]] = doc.name
    locations = {}
    for loc in data["masters"]["locations"]:
        doc = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": LOCATION_NAMES[loc["name"]],
                              "company": COMPANY, "rt_location_code": loc["name"]}).insert()
        locations[loc["name"]] = doc.name
    for r in data["masters"]["remarks"]:
        if not frappe.db.exists("RT Remark", {"remark_code": r["remark_code"]}):
            frappe.get_doc({"doctype": "RT Remark", "remark_code": r["remark_code"], "label": r["label"]}).insert()
    return vendors, locations


def _stamp(doctype: str, name: str, saved: str, seq: int) -> None:
    # The seed's saved time, nudged by seq so no two writes tie.
    when = as_system(as_ist(saved) + timedelta(microseconds=seq))
    frappe.db.set_value(doctype, name, {"creation": when, "modified": when}, update_modified=False)


def load(path: Path) -> dict:
    data = json.loads(Path(path).read_text())
    vendors, locations = _masters(data)
    lots = {lot["key"]: create_lot({"document_type": lot["document_type"], "document_no": lot["document_no"]})["name"]
            for lot in data["lots"]}
    remark = {r["remark_code"]: frappe.db.get_value("RT Remark", {"remark_code": r["remark_code"]})
              for r in data["masters"]["remarks"]}
    buyer = make_buyer("Seed Buyer")
    rolls: dict[str, str] = {}
    steps = sorted([("roll", r) for r in data["rolls"]] + [("move", m) for m in data["movements"]],
                   key=lambda s: s[1]["seq"])
    with patch("royal_touche.movements.check_operator_date"), patch("royal_touche.movements.check_not_future"):
        for kind, step in steps:
            if kind == "roll":
                paper = step["paper"]
                roll = register_roll({
                    "roll_number": step["roll_number"], "barcode": step["barcode"],
                    # A roll whose lot was later removed still needs one to be registered.
                    "lot": lots[step["lot"]] if step["lot"] else next(iter(lots.values())),
                    "vendor": vendors[step["vendor"]], "material": step["material"],
                    "rt_code": paper.get("rt_code"), "delta_code": None if paper.get("rt_code") else paper.get("delta_code"),
                    "gsm": step["gsm"], "width": step["width"], "weight": step["weight"],
                    "location": locations.get(step["location"]), "date": step["received"], "recorded_at": step["saved"],
                })["name"]
                rolls[step["key"]] = roll
                _stamp("Batch", roll, step["saved"], step["seq"])
                for mv in frappe.get_all("Roll Movement", {"roll": roll}, pluck="name"):
                    _stamp("Roll Movement", mv, step["saved"], step["seq"])
                if step.get("lot_removed_after_create"):
                    frappe.db.set_value("Batch", roll, "rt_lot", None, update_modified=False)
                continue
            roll, mtype = rolls[step["roll"]], step["type"]
            if mtype == "DELETE":
                delete_roll(roll)
                continue
            if step.get("roll_remark_codes"):
                set_remark_codes(roll, [remark[c] for c in step["roll_remark_codes"]])
            body = {"movement_type": mtype, "roll": roll, "transaction_date": step["date"], "recorded_at": step["saved"],
                    "issued_to": step.get("issued_to"), "remarks": step.get("remarks")}
            if mtype == "OUT":
                body["location"] = locations[step["location"]]
            elif mtype == "RETURN":
                body["returned_weight"] = step["returned_weight"]
            elif mtype == "ADJUSTMENT":
                body["new_weight"] = step["new_weight"]
            elif mtype == "SELL":
                body["buyer"] = buyer
            mv = record_movement(body)["movement"]["name"]
            _stamp("Roll Movement", mv, step["saved"], step["seq"])
    return {"data": data, "rolls": rolls}
