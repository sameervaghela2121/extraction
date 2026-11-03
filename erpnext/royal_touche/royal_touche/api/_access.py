"""Shared checks for the whitelisted API."""

import frappe

ROLE_SLUGS = (
    ("RT Super Admin", "super_admin"),
    ("System Manager", "super_admin"),
    ("RT Admin", "admin"),
    ("Godown Supervisor", "godown_supervisor"),
    ("Godown Operator", "godown_operator"),
)
GODOWN_ROLES = ["RT Super Admin", "RT Admin", "Godown Supervisor", "Godown Operator", "System Manager"]


def require_godown_role():
    """Node's requireGodownWrite: every RT role (super admin always passes)."""
    frappe.only_for(GODOWN_ROLES)


def rt_role(user: str | None = None) -> str:
    roles = set(frappe.get_roles(user))
    return next((slug for role, slug in ROLE_SLUGS if role in roles), "")


def without_prices(movement: dict) -> dict:
    """Prices are hidden from godown roles (spec §7)."""
    if 1 not in frappe.get_meta("Roll Movement").get_permlevel_access("read"):
        movement = {k: v for k, v in movement.items() if k != "rate_per_roll"}
    return movement
