"""Builders for the ERPNext documents that move a roll's stock. Every one is submitted with
ignore_permissions — godown roles may not create these directly (Global Constraints); our
business actions decide, these only write. Rates are 0 unless a rate per roll is given."""

import frappe
from frappe.utils import flt, get_datetime

from royal_touche.setup.install import COMPANY


def _posting(doc: dict, when) -> dict:
    when = get_datetime(when)
    doc.update({"posting_date": when.date(), "posting_time": when.strftime("%H:%M:%S"), "set_posting_time": 1})
    return doc


def _rate(qty: float, rate_per_roll: float | None) -> float:
    """ERPNext prices per kg; the business prices per roll (spec §7)."""
    if not rate_per_roll or not qty:
        return 0.0
    return flt(rate_per_roll) / flt(qty)


def _submit(doc: dict) -> str:
    d = frappe.get_doc(doc)
    d.flags.ignore_permissions = True
    d.insert()
    d.submit()
    return d.name


def purchase_receipt(batch: str, supplier: str, item: str, qty: float, warehouse: str, when,
                     rate_per_roll: float | None = None) -> str:
    return _submit(_posting({
        "doctype": "Purchase Receipt",
        "company": COMPANY,
        "supplier": supplier,
        "items": [{
            "item_code": item, "qty": qty, "received_qty": qty, "uom": "Kg", "stock_uom": "Kg",
            "conversion_factor": 1, "rate": _rate(qty, rate_per_roll), "warehouse": warehouse,
            "batch_no": batch, "use_serial_batch_fields": 1, "allow_zero_valuation_rate": 1,
        }],
    }, when))


def _line(item: str, qty: float, batch: str, **extra) -> dict:
    return {"item_code": item, "qty": qty, "uom": "Kg", "stock_uom": "Kg", "conversion_factor": 1,
            "batch_no": batch, "use_serial_batch_fields": 1, "allow_zero_valuation_rate": 1, **extra}


def stock_entry(purpose: str, item: str, batch: str, qty: float, when, source: str | None = None,
                target: str | None = None) -> str:
    """purpose: Material Transfer (source → target), Material Issue (from source),
    Material Receipt (into target)."""
    return _submit(_posting({
        "doctype": "Stock Entry",
        "stock_entry_type": purpose,
        "purpose": purpose,
        "company": COMPANY,
        "items": [_line(item, qty, batch, transfer_qty=qty, basic_rate=0, s_warehouse=source, t_warehouse=target)],
    }, when))


def purchase_return(receipt: str, batch: str, qty: float, warehouse: str, when) -> str:
    from erpnext.controllers.sales_and_purchase_return import make_return_doc

    ret = make_return_doc("Purchase Receipt", receipt)
    row = ret.items[0]
    row.update({"qty": -qty, "received_qty": -qty, "rejected_qty": 0, "stock_qty": -qty, "warehouse": warehouse,
                "batch_no": batch, "use_serial_batch_fields": 1, "serial_and_batch_bundle": None,
                "allow_zero_valuation_rate": 1})
    when = get_datetime(when)
    ret.update({"posting_date": when.date(), "posting_time": when.strftime("%H:%M:%S"), "set_posting_time": 1})
    ret.flags.ignore_permissions = True
    ret.insert()
    ret.submit()
    return ret.name


def delivery_note(customer: str, item: str, batch: str, qty: float, warehouse: str, when,
                  rate_per_roll: float | None = None) -> str:
    return _submit(_posting({
        "doctype": "Delivery Note",
        "company": COMPANY,
        "customer": customer,
        "items": [_line(item, qty, batch, rate=_rate(qty, rate_per_roll), warehouse=warehouse)],
    }, when))
