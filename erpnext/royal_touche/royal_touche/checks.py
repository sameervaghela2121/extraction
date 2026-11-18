"""Proof that our cached roll figures and ERPNext's stock ledger say the same thing."""

import frappe
from frappe.utils import flt

LIVE_STOCK = ("IN_STOCK", "ISSUED")


def batch_kg(batch: str, warehouse: str | None = None) -> float:
    """The batch's quantity in the stock ledger: in one warehouse, or across all of them.
    (ERPNext 16's get_batch_qty answers per warehouse when none is given.)"""
    from erpnext.stock.doctype.batch.batch import get_batch_qty

    result = get_batch_qty(batch_no=batch, warehouse=warehouse)
    if isinstance(result, list):
        return flt(sum(flt(r.get("qty")) for r in result), 3)
    if isinstance(result, dict):
        return flt(sum(flt(v) for v in result.values()), 3)
    return flt(result, 3)


def ledger_mismatches(batches: list[str] | None = None) -> list[dict]:
    """Every roll whose expected kg differs from its batch quantity in the stock ledger.

    Expected = the cached remaining weight for a live roll that is in stock or out on the
    floor; 0 for a finished or deleted roll."""
    filters = {"rt_status": ["is", "set"]}
    if batches is not None:
        filters["name"] = ["in", batches or [""]]
    out = []
    for b in frappe.get_all("Batch", filters=filters, fields=["name", "rt_status", "rt_remaining_weight", "rt_deleted"],
                            order_by="name"):
        live = not b.rt_deleted and b.rt_status in LIVE_STOCK
        expected = flt(b.rt_remaining_weight, 3) if live else 0.0
        ledger = batch_kg(b.name)
        if expected != ledger:
            out.append({"roll": b.name, "expected_kg": expected, "ledger_kg": ledger})
    return out


def stock_summary() -> list[dict]:
    """On-hand per material: live rolls in stock (a roll out on the floor is not on hand)."""
    totals: dict[str, dict] = {}
    for b in frappe.get_all("Batch", filters={"rt_status": "IN_STOCK", "rt_deleted": 0},
                            fields=["item", "rt_remaining_weight"]):
        row = totals.setdefault(b.item, {"material": b.item, "on_hand_kg": 0.0, "rolls_in_stock": 0})
        row["on_hand_kg"] = flt(row["on_hand_kg"] + flt(b.rt_remaining_weight), 3)
        row["rolls_in_stock"] += 1
    return sorted(totals.values(), key=lambda r: r["material"])
