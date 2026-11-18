"""Admin portal home dashboard: one overview call for KPIs, period movement, stock and activity.

Assembles figures from the same report/check helpers as Reports and the tablet stock summary —
no new ledger rules. Role rule matches portal_reports (godown_supervisor; super_admin passes)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

import frappe
from frappe.utils import flt

from royal_touche import reports
from royal_touche.checks import stock_summary
from royal_touche.dates import IST
from royal_touche.errors import RTValidation
from royal_touche.portal import require_roles
from royal_touche.report_logic import daily_status
from royal_touche.setup.install import COMPANY, UNASSIGNED_WAREHOUSE

_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_MAX_LISTED_ISSUES = 3
STATUSES = ("IN_STOCK", "ISSUED", "CONSUMED", "RETURNED_TO_VENDOR", "SOLD")
TOP_N = 5
STOCK_TOP_N = 8
ACTIVITY_DAYS = 7


def _allowed() -> None:
    require_roles("godown_supervisor")


def _is_date(value: str) -> bool:
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
    if value is None:
        return field, required, True
    if not isinstance(value, str):
        return field, f"Expected string, received {_js_type(value)}", True
    if not _is_date(value):
        return field, invalid, False
    return None


def _refuse(issues: list[tuple[str, str, bool]]) -> None:
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


def _period(query: dict) -> tuple[str, str]:
    frm, to = query.get("from"), query.get("to")
    issues = [issue for issue in (
        _date_issue("from", frm, "From date is required", "From must be YYYY-MM-DD"),
        _date_issue("to", to, "To date is required", "To must be YYYY-MM-DD"),
    ) if issue]
    if not any(aborts for _, _, aborts in issues) and not frm <= to:
        issues.append(("from", "From must not be after to", False))
    if issues:
        _refuse(issues)
    return frm, to


def _today_ist() -> str:
    return datetime.now(IST).date().isoformat()


def _roll_kpis() -> tuple[int, dict[str, int], float, float]:
    """Live rolls (non-deleted with a status): total, by status, on-hand kg, out-on-floor kg."""
    by_status = {s: 0 for s in STATUSES}
    on_hand = 0.0
    out_floor = 0.0
    total = 0
    for b in frappe.get_all(
        "Batch",
        filters={"rt_deleted": 0, "rt_status": ["is", "set"]},
        fields=["rt_status", "rt_remaining_weight"],
    ):
        status = b.rt_status
        if status not in by_status:
            by_status[status] = 0
        by_status[status] += 1
        total += 1
        kg = flt(b.rt_remaining_weight, 3)
        if status == "IN_STOCK":
            on_hand = flt(on_hand + kg, 3)
        elif status == "ISSUED":
            out_floor = flt(out_floor + kg, 3)
    return total, by_status, on_hand, out_floor


def _master_counts() -> dict[str, int]:
    return {
        "lots_total": frappe.db.count("Roll Lot"),
        "vendors_total": frappe.db.count("Supplier", {"rt_vendor_code": ["is", "set"]}),
        "locations_total": frappe.db.count(
            "Warehouse",
            {
                "is_group": 0,
                "company": COMPANY,
                "rt_location_code": ["is", "set"],
                "name": ["!=", UNASSIGNED_WAREHOUSE],
            },
        ),
        "materials_total": frappe.db.count("Item", {"rt_material_code": ["is", "set"]}),
    }


def _top_rows(rows: list[dict], field: str, limit: int = TOP_N) -> list[dict]:
    ranked = sorted(rows, key=lambda r: (-flt(r.get(field) or 0), r.get("material") or ""))
    out = []
    for row in ranked:
        if flt(row.get(field) or 0) <= 0:
            continue
        out.append({
            "material_code": row.get("material_code") or "",
            "material": row.get("material") or "",
            "kg": flt(row[field], 3),
        })
        if len(out) >= limit:
            break
    return out


def _activity_7d(ledger, rolls, today: str) -> list[dict]:
    end = date.fromisoformat(today)
    out = []
    for i in range(ACTIVITY_DAYS - 1, -1, -1):
        day = (end - timedelta(days=i)).isoformat()
        out.append({"date": day, "count": daily_status.count(ledger, rolls, day)})
    return out


@frappe.whitelist(methods=["GET"])
def overview(**query) -> dict:
    """KPIs + period consumption totals + stock top + 7-day activity for the portal home."""
    _allowed()
    frm, to = _period(query)
    today = _today_ist()

    rolls_total, rolls_by_status, on_hand_kg, out_on_floor_kg = _roll_kpis()
    masters = _master_counts()

    ledger, rolls, _, _ = reports.load()
    moved_today = daily_status.count(ledger, rolls, today)
    period = reports.consumption_summary(frm, to, "material")

    stock = sorted(stock_summary(), key=lambda r: (-flt(r["on_hand_kg"]), r["material"]))
    stock_top = [
        {
            "material": row["material"],
            "on_hand_kg": flt(row["on_hand_kg"], 3),
            "rolls_in_stock": int(row["rolls_in_stock"]),
        }
        for row in stock[:STOCK_TOP_N]
    ]

    return {
        "kpis": {
            "rolls_total": rolls_total,
            "rolls_by_status": rolls_by_status,
            "on_hand_kg": on_hand_kg,
            "out_on_floor_kg": out_on_floor_kg,
            "lots_total": masters["lots_total"],
            "vendors_total": masters["vendors_total"],
            "locations_total": masters["locations_total"],
            "materials_total": masters["materials_total"],
            "moved_today": moved_today,
        },
        "period": {
            "from": period["from"],
            "to": period["to"],
            "totals": period["totals"],
            "top_consumed": _top_rows(period["rows"], "consumed"),
            "top_out_on_floor": _top_rows(period["rows"], "out_at_close"),
        },
        "stock_on_hand_top": stock_top,
        "activity_7d": _activity_7d(ledger, rolls, today),
    }
