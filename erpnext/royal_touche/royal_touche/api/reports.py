"""CSV downloads for the portal. The on-screen figures come from the RT Consumption and
RT Daily Roll Status script reports, through Frappe's standard report API."""

import frappe
from frappe.utils import getdate

from royal_touche import reports
from royal_touche.errors import RTValidation

# Node: router.use(requireAuth, requireRole("godown_supervisor")); super_admin always passes.
REPORT_ROLES = ["Godown Supervisor", "RT Super Admin", "System Manager"]


def _period(from_date, to_date):
    frm, to = getdate(from_date), getdate(to_date)
    if frm > to:
        raise RTValidation("from must be on or before to")
    return frm, to


def _download(filename: str, content: str) -> None:
    frappe.response["type"] = "download"
    frappe.response["filename"] = filename
    frappe.response["filecontent"] = content
    frappe.response["content_type"] = "text/csv; charset=utf-8"


@frappe.whitelist(methods=["GET"])
def consumption_summary_csv(from_date: str, to_date: str, group: str = "material") -> None:
    frappe.only_for(REPORT_ROLES)
    frm, to = _period(from_date, to_date)
    if group not in ("material", "design"):
        raise RTValidation("Group by material or design")
    _download(f"consumption-{group}-{frm}-to-{to}.csv", reports.consumption_summary_csv(frm, to, group))


@frappe.whitelist(methods=["GET"])
def consumption_detail_csv(from_date: str, to_date: str) -> None:
    frappe.only_for(REPORT_ROLES)
    frm, to = _period(from_date, to_date)
    _download(f"consumption-detail-{frm}-to-{to}.csv", reports.consumption_detail_csv(frm, to))


@frappe.whitelist(methods=["GET"])
def daily_rolls_csv(date: str) -> None:
    frappe.only_for(REPORT_ROLES)
    day = getdate(date)
    _download(f"daily-roll-status-{day}.csv", reports.daily_csv(day))
