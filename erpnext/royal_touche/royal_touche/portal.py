"""Shared pieces for the admin portal's endpoints (royal_touche.api.portal_*): the old server's
page shape and role rules, so the portal's screens read exactly what they did before."""

import math

import frappe
from frappe.utils import cint

from royal_touche.api._access import rt_role

# backend/src/middleware/rbac.middleware.ts: requireGodownWrite. super_admin always passes.
GODOWN_WRITE = ("admin", "store_manager", "godown_supervisor", "godown_operator")
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def require_roles(*roles: str) -> None:
    """requireRole(): the user's role must be one of [roles]; super_admin always passes."""
    role = rt_role()
    if role != "super_admin" and role not in roles:
        frappe.throw("You do not have permission to perform this action", frappe.PermissionError)


def page_window(page, page_size, default_size: int = DEFAULT_PAGE_SIZE) -> tuple[int, int, int]:
    """(page, page_size, offset) from the request, clamped as the old validators did."""
    page = max(1, cint(page) or 1)
    page_size = min(MAX_PAGE_SIZE, max(1, cint(page_size) or default_size))
    return page, page_size, (page - 1) * page_size


def page_of(items: list, total: int, page: int, page_size: int) -> dict:
    """The old server's Paginated<T>: { items, total, page, pageSize, totalPages }."""
    return {"items": items, "total": total, "page": page, "pageSize": page_size,
            "totalPages": max(1, math.ceil(total / page_size))}
