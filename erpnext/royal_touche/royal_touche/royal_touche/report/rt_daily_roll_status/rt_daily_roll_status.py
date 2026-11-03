import frappe
from frappe.utils import getdate

from royal_touche import reports
from royal_touche.report_logic.daily_status import REPORT_COLUMNS


def execute(filters=None):
    filters = filters or {}
    rows = reports.daily_rows(getdate(filters.get("date")))
    columns = [{"fieldname": frappe.scrub(label), "label": label, "fieldtype": "Data", "width": 140}
               for label in REPORT_COLUMNS]
    data = [{frappe.scrub(label): row[label] for label in REPORT_COLUMNS} for row in rows]
    return columns, data
