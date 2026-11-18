"""ERPNext's whitelisted rate lookups have no permission check, so role permissions can't keep
prices from godown roles (spec §7 anti-goal). These stand in for them through
override_whitelisted_methods; everyone else gets ERPNext's own answer."""

import frappe

GODOWN_ONLY = {"Godown Supervisor", "Godown Operator"}
SEES_PRICES = {"RT Super Admin", "RT Admin", "System Manager"}


def _refuse_godown_roles() -> None:
    roles = set(frappe.get_roles())
    if roles & GODOWN_ONLY and not roles & SEES_PRICES:
        raise frappe.PermissionError("You do not have permission to perform this action")


def _passed(kwargs: dict) -> dict:
    return {k: v for k, v in kwargs.items() if k != "cmd"}


@frappe.whitelist()
def get_incoming_rate(**kwargs):
    _refuse_godown_roles()
    from erpnext.stock.utils import get_incoming_rate as original

    return original(**_passed(kwargs))


@frappe.whitelist()
def get_stock_balance(**kwargs):
    _refuse_godown_roles()
    from erpnext.stock.utils import get_stock_balance as original

    return original(**_passed(kwargs))


@frappe.whitelist()
def get_valuation_rate(**kwargs):
    _refuse_godown_roles()
    from erpnext.stock.get_item_details import get_valuation_rate as original

    return original(**_passed(kwargs))
