"""Lots: one per delivery, identified by its challan or invoice."""

import frappe

from royal_touche import replay

LOT_FIELDS = ("name", "document_type", "document_no", "document_photo", "client_id", "creation", "modified")


def create_lot(data: dict) -> dict:
    existing = replay.find("Roll Lot", "client_id", data.get("client_id"))
    if existing:
        return lot_dict(existing)
    return replay.guarded("Roll Lot", "client_id", data.get("client_id"), lambda: _create(data), lot_dict)


def _create(data: dict) -> dict:
    doc = frappe.get_doc(
        {
            "doctype": "Roll Lot",
            "document_type": data.get("document_type"),
            "document_no": data.get("document_no"),
            "document_photo": data.get("document_photo"),
            "client_id": data.get("client_id") or None,
        }
    ).insert(ignore_permissions=True)
    return lot_dict(doc.name)


def lot_dict(name: str) -> dict:
    return frappe.db.get_value("Roll Lot", name, LOT_FIELDS, as_dict=True)
