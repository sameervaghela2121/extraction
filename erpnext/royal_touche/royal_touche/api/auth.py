"""App login (user's choice, Option B): ERPNext checks the password; the tokens are ERPNext
OAuth Bearer Tokens, so ERPNext's own validate_oauth authenticates every later request and
already refuses revoked tokens and disabled users."""

from datetime import timedelta

import frappe
from frappe.rate_limiter import rate_limit
from frappe.utils import add_to_date, now_datetime

from royal_touche.api._access import rt_role

APP_CLIENT = "Royal Touche App"
ACCESS_SECONDS = 3600
REFRESH_DAYS = 30
BAD_LOGIN = "Invalid login credentials"


def app_client() -> str:
    """The OAuth Client every app token belongs to (made by setup.install.ensure_setup)."""
    name = frappe.db.get_value("OAuth Client", {"app_name": APP_CLIENT})
    if not name:
        frappe.throw("The Royale Touche app is not set up on this site", frappe.AuthenticationError)
    return name


def _issue(user: str) -> dict:
    access, refresh_token = frappe.generate_hash(length=40), frappe.generate_hash(length=40)
    frappe.get_doc({
        "doctype": "OAuth Bearer Token",
        "client": app_client(),
        "user": user,
        "scopes": "all",
        "access_token": access,
        "refresh_token": refresh_token,
        "expires_in": ACCESS_SECONDS,
        "expiration_time": add_to_date(now_datetime(), seconds=ACCESS_SECONDS),
        "status": "Active",
    }).insert(ignore_permissions=True)
    return {"access_token": access, "refresh_token": refresh_token, "expires_in": ACCESS_SECONDS, **_who(user)}


def _who(user: str) -> dict:
    return {"user": user, "full_name": frappe.utils.get_fullname(user), "role": rt_role(user)}


def _revoke(name: str) -> None:
    frappe.db.set_value("OAuth Bearer Token", name, {"status": "Revoked", "expiration_time": now_datetime()})


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=5 * 60)
def login(usr: str, pwd: str) -> dict:
    from frappe.utils.password import check_password

    user = frappe.db.get_value("User", {"name": (usr or "").strip()}, ["name", "enabled"], as_dict=True) or \
        frappe.db.get_value("User", {"email": (usr or "").strip()}, ["name", "enabled"], as_dict=True)
    if not user or not user.enabled:
        raise frappe.AuthenticationError(BAD_LOGIN)
    try:
        check_password(user.name, pwd or "")
    except frappe.AuthenticationError:
        raise frappe.AuthenticationError(BAD_LOGIN) from None
    if not rt_role(user.name):
        raise frappe.AuthenticationError("You do not have access to the Royale Touche app")
    return _issue(user.name)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=60, seconds=5 * 60)
def refresh(refresh_token: str) -> dict:
    token = frappe.db.get_value(
        "OAuth Bearer Token", {"refresh_token": refresh_token or "", "status": "Active", "client": app_client()},
        ["name", "user", "modified"], as_dict=True,
    ) if refresh_token else None
    unused_too_long = token and token.modified < now_datetime() - timedelta(days=REFRESH_DAYS)
    if not token or unused_too_long or not frappe.db.get_value("User", token.user, "enabled") or not rt_role(token.user):
        if token:
            _revoke(token.name)
        raise frappe.AuthenticationError("Session expired. Please sign in again.")
    _revoke(token.name)
    return _issue(token.user)


@frappe.whitelist(methods=["POST"])
def logout() -> str:
    for name in frappe.get_all("OAuth Bearer Token", {"user": frappe.session.user, "status": "Active",
                                                      "client": app_client()}, pluck="name"):
        _revoke(name)
    return "ok"


@frappe.whitelist(methods=["GET"])
def me() -> dict:
    return _who(frappe.session.user)
