"""Builders for the ERPNext documents that move a roll's stock.

Godown roles have no rights on stock documents (Global Constraints): our business actions
check every rule and role first, then post these as the system user — ERPNext checks the
session user's permissions on its own internal records (accounts, serial/batch bundles)
even when a document skips its own check. The person who acted is recorded as the owner.
Rates are 0 unless a rate per roll is given."""

from contextlib import contextmanager

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


@contextmanager
def as_system():
    """Run ERPNext's own writes as Administrator; yields the real user's id.

    frappe.set_user() changes the session object in place, and that same object is
    frappe.local.session_obj.data, which Frappe saves to the session cache at the end of the
    request. So the original object is kept and its contents put back in place: restoring a
    copy would leave the request's real session saying Administrator. set_user() also clears
    form_dict and the cached permissions, which are put back too."""
    local = frappe.local
    session = local.session
    saved_session = dict(session)
    form_dict = local.form_dict
    role_permissions = getattr(local, "role_permissions", {})
    user_perms = getattr(local, "user_perms", None)
    new_doc_templates = getattr(local, "new_doc_templates", {})
    actor = session.user
    frappe.set_user("Administrator")
    try:
        yield actor
    finally:
        session.clear()
        session.update(saved_session)
        local.session = session
        local.form_dict = form_dict
        local.role_permissions = role_permissions
        local.user_perms = user_perms
        local.new_doc_templates = new_doc_templates
        # Holds per-user lookups made while acting as Administrator (roles among them).
        local.cache = {}


def _owned_by(doctype: str, name: str, actor: str) -> str:
    frappe.db.set_value(doctype, name, "owner", actor, update_modified=False)
    return name


def _submit(doc: dict) -> str:
    with as_system() as actor:
        d = frappe.get_doc(doc)
        d.insert()
        d.submit()
    return _owned_by(d.doctype, d.name, actor)


def cancel(doctype: str, name: str) -> None:
    with as_system():
        d = frappe.get_doc(doctype, name)
        if d.docstatus == 1:
            d.cancel()


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

    with as_system() as actor:
        name = _purchase_return(make_return_doc("Purchase Receipt", receipt), batch, qty, warehouse, when)
    return _owned_by("Purchase Receipt", name, actor)


def _purchase_return(ret, batch: str, qty: float, warehouse: str, when) -> str:
    row = ret.items[0]
    row.update({"qty": -qty, "received_qty": -qty, "rejected_qty": 0, "stock_qty": -qty, "warehouse": warehouse,
                "batch_no": batch, "use_serial_batch_fields": 1, "serial_and_batch_bundle": None,
                "allow_zero_valuation_rate": 1})
    when = get_datetime(when)
    ret.update({"posting_date": when.date(), "posting_time": when.strftime("%H:%M:%S"), "set_posting_time": 1})
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
