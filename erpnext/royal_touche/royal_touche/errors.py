"""Errors that carry what the client can act on: an HTTP status and a stable reason code.

The sync batch reports `reason` per item; the tablet switches on it, never on the wording
(backend/src/services/sync.service.ts, FailureReason)."""

import frappe


class RTError(frappe.ValidationError):
    http_status_code = 400
    reason = "validation"

    def __init__(self, *args):
        super().__init__(*args)
        # Without developer mode ERPNext sends the client only its message log, never the
        # exception's own text. The sync batch clears this and reports the error per item.
        if args:
            frappe.msgprint(str(args[0]))


class RTValidation(RTError):
    http_status_code = 400
    reason = "validation"


class RTDuplicate(RTError):
    http_status_code = 409
    reason = "duplicate"


class RTConflict(RTError):
    http_status_code = 409
    reason = "conflict"


class RTNotFound(RTError):
    http_status_code = 404
    reason = "not_found"


class RTForbidden(RTError):
    http_status_code = 403
    reason = "forbidden"
