"""A retried offline write carries the client_id of its first attempt. Finding it again is
how a retry returns the original result instead of writing twice."""

import frappe


def find(doctype: str, field: str, client_id: str | None, fresh: bool = False) -> str | None:
    """fresh: a locking read, which sees what has been committed since this transaction began
    (an ordinary read under MariaDB's REPEATABLE READ does not)."""
    if not client_id:
        return None
    return frappe.db.get_value(doctype, {field: client_id}, "name", for_update=fresh)


def guarded(doctype: str, field: str, client_id: str | None, write, replay_result):
    """Run `write()`; if it fails and another request with the same client_id has meanwhile
    written the record (two copies of one retry racing), undo this attempt's partial writes
    and return the winner's result instead of the error. The winner committed after this
    transaction began, so both the lookup and `replay_result(name, fresh=True)` must use
    locking reads."""
    if not client_id:
        return write()
    savepoint = f"rt_replay_{frappe.generate_hash(length=8)}"
    frappe.db.savepoint(savepoint)
    try:
        return write()
    except Exception as error:
        try:
            frappe.db.rollback(save_point=savepoint)
        except Exception:
            raise error from None  # a deadlock already ended the transaction, savepoint included
        winner = find(doctype, field, client_id, fresh=True)
        if not winner:
            raise
        frappe.local.message_log = []
        return replay_result(winner, fresh=True)
