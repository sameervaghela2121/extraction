"""A retried offline write carries the client_id of its first attempt. Finding it again is
how a retry returns the original result instead of writing twice."""

import frappe


def find(doctype: str, field: str, client_id: str | None) -> str | None:
    if not client_id:
        return None
    return frappe.db.get_value(doctype, {field: client_id}, "name")
