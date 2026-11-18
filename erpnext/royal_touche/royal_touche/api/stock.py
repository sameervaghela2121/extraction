import frappe

from royal_touche.api._access import require_godown_role
from royal_touche.checks import stock_summary


@frappe.whitelist(methods=["GET"])
def summary() -> list[dict]:
    require_godown_role()
    return stock_summary()
