"""A retried offline write carries the client_id of its first attempt. Finding it again is
how a retry returns the original result instead of writing twice."""

import frappe


def find(doctype: str, field: str, client_id: str | None) -> str | None:
    if not client_id:
        return None
    return frappe.db.get_value(doctype, {field: client_id}, "name")


def guarded(doctype: str, field: str, client_id: str | None, write, replay_result):
    """Run `write()`; if it fails and another request with the same client_id has meanwhile
    written the record (two copies of one retry racing), undo this attempt's partial writes
    and return the winner's result instead of the error."""
    if not client_id:
        return write()
    savepoint = f"rt_replay_{frappe.generate_hash(length=8)}"
    frappe.db.savepoint(savepoint)
    try:
        return write()
    except Exception:
        winner = find(doctype, field, client_id)
        if not winner:
            raise
        frappe.db.rollback(save_point=savepoint)
        frappe.local.message_log = []
        return replay_result(winner)
