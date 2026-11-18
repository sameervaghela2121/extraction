"""The admin portal's reports, as the old server answered them (backend/src/routes/reports.routes.ts,
controllers/reports.controller.ts, validators/reports.validators.ts):

    daily_rolls_count        GET /reports/daily-rolls/count      -> { count }
    daily_rolls              GET /reports/daily-rolls            -> daily-roll-report-<date>.csv
    consumption              GET /reports/consumption            -> { from, to, group, rows, totals }
    consumption_summary_csv  GET /reports/consumption/summary.csv
    consumption_detail_csv   GET /reports/consumption/detail.csv

Arguments keep the old query names (`from` is a Python keyword, hence **query). The figures come
from royal_touche.reports, which the parity tests hold to the Node services' output."""

import re
from datetime import date

import frappe

from royal_touche import reports
from royal_touche.errors import RTValidation
from royal_touche.portal import require_roles
from royal_touche.report_logic import daily_status

GROUPS = ("material", "design")
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_MAX_LISTED_ISSUES = 3


def _allowed() -> None:
    # router.use(requireAuth, requireRole("godown_supervisor")): before any validation.
    require_roles("godown_supervisor")


def _is_date(value: str) -> bool:
    """zod's .date(): exactly YYYY-MM-DD, and a real day of the calendar."""
    if not _DATE.fullmatch(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _js_type(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int | float):
        return "number"
    if isinstance(value, list | tuple):
        return "array"
    return "object"


def _date_issue(field: str, value, required: str, invalid: str) -> tuple[str, str, bool] | None:
    """(field, message, aborts) for one z.string({ required_error }).date(invalid) field."""
    if value is None:
        return field, required, True
    if not isinstance(value, str):
        return field, f"Expected string, received {_js_type(value)}", True
    if not _is_date(value):
        return field, invalid, False
    return None


def _refuse(issues: list[tuple[str, str, bool]]) -> None:
    """validate.middleware.ts zodMessage(): up to three messages, each prefixed with its field
    unless the message already names it; a 400 the portal shows verbatim."""
    seen: list[str] = []
    for field, message, _ in issues:
        text = f"{field}: {message}" if field and field not in message.lower() else message
        if text not in seen:
            seen.append(text)
        if len(seen) == _MAX_LISTED_ISSUES:
            break
    listed = ", ".join(seen)
    remaining = len(issues) - len(seen)
    raise RTValidation(f"{listed} (and {remaining} more)" if remaining > 0 else listed)


def _period(query: dict) -> tuple[str, str, str]:
    """consumptionReportQuerySchema: from, to (YYYY-MM-DD, from <= to), group (default material)."""
    frm, to, group = query.get("from"), query.get("to"), query.get("group")
    issues = [issue for issue in (
        _date_issue("from", frm, "From date is required", "From must be YYYY-MM-DD"),
        _date_issue("to", to, "To date is required", "To must be YYYY-MM-DD"),
    ) if issue]
    if group is None:
        group = "material"
    elif group not in GROUPS:
        received = group if isinstance(group, str) else _js_type(group)
        issues.append(("group", f"Invalid enum value. Expected 'material' | 'design', received '{received}'", True))
    # zod runs the refine unless a field was missing or of the wrong kind; a badly written date
    # still gets it, compared as text.
    if not any(aborts for _, _, aborts in issues) and not frm <= to:
        issues.append(("from", "From must not be after to", False))
    if issues:
        _refuse(issues)
    return frm, to, group


def _day(query: dict) -> str:
    """dailyRollReportQuerySchema: the business day, in India time."""
    day = query.get("date")
    issue = _date_issue("date", day, "Date is required", "Date must be YYYY-MM-DD")
    if issue:
        _refuse([issue])
    return day


def _send_csv(filename: str, csv: str) -> None:
    frappe.response["type"] = "download"
    frappe.response["filename"] = filename
    frappe.response["filecontent"] = csv
    # Werkzeug adds "; charset=utf-8" to text/* itself: the header reads as Node's.
    frappe.response["content_type"] = "text/csv"


@frappe.whitelist(methods=["GET"])
def daily_rolls_count(**query) -> dict:
    """How many rolls moved on an India-time day."""
    _allowed()
    day = _day(query)
    ledger, rolls, _, _ = reports.load()
    return {"count": daily_status.count(ledger, rolls, day)}


@frappe.whitelist(methods=["GET"])
def daily_rolls(**query) -> None:
    _allowed()
    day = _day(query)
    _send_csv(f"daily-roll-report-{day}.csv", reports.daily_csv(day))


@frappe.whitelist(methods=["GET"])
def consumption(**query) -> dict:
    _allowed()
    frm, to, group = _period(query)
    return reports.consumption_summary(frm, to, group)


@frappe.whitelist(methods=["GET"])
def consumption_summary_csv(**query) -> None:
    _allowed()
    frm, to, group = _period(query)
    name = "consumption-by-design" if group == "design" else "consumption-summary"
    _send_csv(f"{name}-{frm}-to-{to}.csv", reports.consumption_summary_csv(frm, to, group))


@frappe.whitelist(methods=["GET"])
def consumption_detail_csv(**query) -> None:
    # The old route validated the detail with the same schema, group included.
    _allowed()
    frm, to, _ = _period(query)
    _send_csv(f"consumption-detail-{frm}-to-{to}.csv", reports.consumption_detail_csv(frm, to))
