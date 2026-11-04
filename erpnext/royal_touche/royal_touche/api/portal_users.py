"""The admin portal's user management, and the invite / forgot / reset password flows.

Rules from the old Node server (backend/src/services/{users,auth}.service.ts,
routes/users.routes.ts): admins and godown supervisors manage godown accounts; deleting is
admin-only; super_admin always passes and can never be granted, edited or removed from here.

Mapping onto ERPNext:
- An account is a User. This panel manages an account only when its roles are just the godown
  ones (Godown Supervisor and/or Godown Operator, besides Guest / All / Desk User); anything
  else (RT Admin, RT Super Admin, System Manager, any other ERPNext role) is "managed outside
  this panel", the same boundary Node drew with GODOWN_ROLES.
- Status: disabled → "suspended"; enabled with no password stored → "invited"; enabled with a
  password → "active".
- Invite and reset links carry a key of the portal's own, kept on the User as rt_link_key_hash
  (its sha256), rt_link_purpose (invite / reset) and rt_link_expires. Never ERPNext's own
  User.reset_password_key: ERPNext's guest update_password accepts that one with no expiry and
  none of these checks. An invite key only accepts an invite, a reset key only resets. One key
  per user: issuing a new link retires the previous one. Links are queued in ERPNext's Email
  Queue and go out once an outgoing email account is set up.
"""

from datetime import timedelta

import frappe
from frappe.permissions import ADMIN_ROLE, AUTOMATIC_ROLES
from frappe.rate_limiter import rate_limit
from frappe.utils import escape_html, get_url, now_datetime, validate_email_address
from frappe.utils.data import sha256_hash
from frappe.utils.password import delete_login_failed_cache, update_password

from royal_touche.api._access import rt_role
from royal_touche.api.auth import _issue
from royal_touche.errors import RTDuplicate, RTForbidden, RTNotFound, RTValidation
from royal_touche.portal import page_of, page_window, require_roles

SUPERVISOR, OPERATOR = "Godown Supervisor", "Godown Operator"
ROLE_OF = {"godown_supervisor": SUPERVISOR, "godown_operator": OPERATOR}
PANEL_ROLES = (SUPERVISOR, OPERATOR)
# Roles every account has by its type (Guest, All, Desk User). ERPNext lists the Administrator
# role among its automatic ones too, but an account holding it is anything but a godown one.
IGNORED_ROLES = tuple(r for r in AUTOMATIC_ROLES if r != ADMIN_ROLE)
STATUSES = ("invited", "active", "suspended")
SORTS = {"createdAt": "u.creation", "name": "full_name", "email": "u.email"}
DEFAULT_PAGE_SIZE = 25  # backend/src/validators/search.validators.ts
MIN_PASSWORD, MAX_PASSWORD = 8, 128
INVITE_TTL = timedelta(days=7)
RESET_TTL = timedelta(hours=1)

OUTSIDE = "This account is managed outside this panel"
SUPER = "Super admin accounts can only be changed directly in the database"
TAKEN = "A user with this email already exists"
BAD_INVITE = "This invite is invalid or has expired"
BAD_RESET = "This reset link is invalid or has expired"
FORGOT_REPLY = "If that email exists, a reset link has been sent."


# ---- validation, worded as the old server's zod schemas worded it ----

def _check(issues: list) -> None:
    """validate.middleware.ts zodMessage(): up to three issues, field-prefixed where the message
    doesn't already name the field."""
    issues = [i for i in issues if i]
    if not issues:
        return
    seen = []
    for field, message in issues:
        text = f"{field}: {message}" if field and field not in message.lower() else message
        if text not in seen:
            seen.append(text)
        if len(seen) == 3:
            break
    listed, remaining = ", ".join(seen), len(issues) - len(seen)
    raise RTValidation(f"{listed} (and {remaining} more)" if remaining > 0 else listed)


def _enum(field: str, value, allowed, required: bool = True):
    if value is None or value == "":
        return (field, "Required") if required else None
    if value not in allowed:
        expected = " | ".join(f"'{a}'" for a in allowed)
        return field, f"Invalid enum value. Expected {expected}, received '{value}'"
    return None


def _password_issue(password):
    if not isinstance(password, str):
        return "password", "Required"
    if len(password) < MIN_PASSWORD:
        return "password", f"Password must be at least {MIN_PASSWORD} characters"
    if len(password) > MAX_PASSWORD:
        return "password", f"String must contain at most {MAX_PASSWORD} character(s)"
    return None


def _clean_email(email) -> str:
    email = (email or "").strip().lower() if isinstance(email, str) else ""
    return email if email and validate_email_address(email) == email else ""


# ---- reading accounts ----

def _has_password(user: str) -> bool:
    return bool(frappe.db.exists("__Auth", {"doctype": "User", "name": user, "fieldname": "password"}))


def _assigned_roles(user: str) -> set[str]:
    roles = frappe.db.sql_list("select role from `tabHas Role` where parenttype = 'User' and parent = %s", user)
    return set(roles) - set(IGNORED_ROLES)


def _panel_role(user: str) -> str | None:
    """The account's godown role slug when this panel manages it, else None."""
    if user in frappe.STANDARD_USERS:
        return None
    roles = _assigned_roles(user)
    if not roles or not roles <= set(PANEL_ROLES):
        return None
    return "godown_supervisor" if SUPERVISOR in roles else "godown_operator"


def _status(user: str, enabled) -> str:
    if not enabled:
        return "suspended"
    return "active" if _has_password(user) else "invited"


def _row(user: str) -> dict:
    u = frappe.db.get_value("User", user, ["name", "full_name", "email", "enabled"], as_dict=True)
    return {"id": u.name, "name": u.full_name or u.name, "email": u.email or u.name,
            "role": _panel_role(u.name) or rt_role(u.name), "status": _status(u.name, u.enabled)}


def _find_by_email(email: str) -> str | None:
    return frappe.db.get_value("User", email) or frappe.db.get_value("User", {"email": email})


def _target(user) -> frappe._dict:
    if not user or not isinstance(user, str):
        raise RTValidation("Invalid user id")
    row = frappe.db.get_value("User", user, ["name", "enabled"], as_dict=True)
    if not row:
        raise RTNotFound("User not found")
    return row


def _acting() -> str:
    return rt_role()


# ---- the link key ----

INVITE, RESET = "invite", "reset"
TTL = {INVITE: INVITE_TTL, RESET: RESET_TTL}
# Cleared to retire a link. ERPNext's own reset key goes too: a link sent from ERPNext's login
# page must not outlive a suspension or a password set here either.
KEY_FIELDS = ("rt_link_key_hash", "rt_link_purpose", "rt_link_expires", "reset_password_key")


def _no_key() -> dict:
    # A fresh dict each time: db.set_value adds `modified` to the dict it is given.
    return dict.fromkeys(KEY_FIELDS)


def _issue_key(user: str, purpose: str) -> str:
    key = frappe.generate_hash()
    frappe.db.set_value("User", user, {"rt_link_key_hash": sha256_hash(key), "rt_link_purpose": purpose,
                                       "rt_link_expires": now_datetime() + TTL[purpose]})
    return key


def _clear_key(user: str) -> None:
    frappe.db.set_value("User", user, _no_key())


def _user_for_key(token, purpose: str) -> str | None:
    """The enabled RT account a live key of this purpose belongs to, else None."""
    if not token or not isinstance(token, str):
        return None
    row = frappe.db.get_value("User", {"rt_link_key_hash": sha256_hash(token)},
                              ["name", "enabled", "rt_link_purpose", "rt_link_expires"], as_dict=True)
    if (not row or not row.enabled or row.name in frappe.STANDARD_USERS or row.rt_link_purpose != purpose
            or not row.rt_link_expires or now_datetime() > row.rt_link_expires or not rt_role(row.name)):
        return None
    return row.name


def _set_password(user: str, password: str) -> None:
    update_password(user, password)
    _clear_key(user)  # an emailed invite or reset link must not override this later
    delete_login_failed_cache(user)


def _portal_url() -> str:
    """Where the admin portal is served (Node: env.frontendOrigin). Never from the request's
    Host header: a forged one would send the key to someone else's site."""
    return (frappe.conf.get("rt_portal_url") or get_url(allow_header_override=False)).rstrip("/")


def _send_link(recipient: str, subject: str, link: str, text: str = "") -> None:
    """Queues the email carrying an invite or reset link (Node: email.service.ts). With no
    outgoing email account set up: on a developer machine the link goes to
    logs/royal_touche.mail.log so it can still be tried; on a server the link is a live
    password key and never touches a log, and the sender is told the email didn't go."""
    try:
        frappe.sendmail(
            recipients=[recipient],
            subject=subject,
            message=f'{text}<p><a href="{link}">{escape_html(subject)}</a></p>',
            delayed=True,
        )
    except frappe.OutgoingEmailError:
        frappe.clear_last_message()
        log = frappe.logger("royal_touche.mail", allow_site=True)
        if frappe.conf.get("developer_mode"):
            log.error(f"[email:unsent] To: {recipient} | {subject} | {link}")
            return
        log.error(f"[email:unsent] To: {recipient} | {subject} | no outgoing email account")
        raise RTValidation("The email could not be sent — set up an outgoing email account first")


# ---- user management (routes/users.routes.ts) ----

_PANEL_FROM = """
    from `tabUser` u
    where u.name not in ('Administrator', 'Guest')
      and exists (select 1 from `tabHas Role` r where r.parenttype = 'User' and r.parent = u.name
                  and r.role in %(panel)s)
      and not exists (select 1 from `tabHas Role` r where r.parenttype = 'User' and r.parent = u.name
                      and r.role not in %(allowed)s)
"""
_PANEL_COLUMNS = """
    select u.name as id, coalesce(nullif(u.full_name, ''), u.name) as full_name, u.email, u.enabled,
      exists (select 1 from `tabHas Role` r where r.parenttype = 'User' and r.parent = u.name
              and r.role = 'Godown Supervisor') as supervisor,
      exists (select 1 from `__Auth` a where a.doctype = 'User' and a.name = u.name
              and a.fieldname = 'password') as has_password
"""


def _panel_params(**extra) -> dict:
    return {"panel": PANEL_ROLES, "allowed": PANEL_ROLES + IGNORED_ROLES, **extra}


def _listed(r) -> dict:
    status = "suspended" if not r.enabled else "active" if r.has_password else "invited"
    return {"id": r.id, "name": r.full_name, "email": r.email or r.id,
            "role": "godown_supervisor" if r.supervisor else "godown_operator", "status": status}


@frappe.whitelist(methods=["GET"])
def list_users() -> list[dict]:
    """Every godown account, oldest first — the godown-only boundary for every caller."""
    require_roles("admin", "godown_supervisor")
    rows = frappe.db.sql(f"{_PANEL_COLUMNS} {_PANEL_FROM} order by u.creation asc, u.name asc",
                         _panel_params(), as_dict=True)
    return [_listed(r) for r in rows]


@frappe.whitelist(methods=["GET"])
def search(page=1, page_size=DEFAULT_PAGE_SIZE, q: str | None = None, sort: str | None = None,
           order: str | None = None) -> dict:
    """One page of the user table, searched by name or email (usersService.search)."""
    require_roles("admin", "godown_supervisor")
    q = (q or "").strip()
    _check([
        ("q", "String must contain at most 100 character(s)") if len(q) > 100 else None,
        _enum("sort", sort, tuple(SORTS), required=False),
        _enum("order", order, ("asc", "desc"), required=False),
    ])
    page, page_size, offset = page_window(page, page_size, DEFAULT_PAGE_SIZE)
    where, params = "", _panel_params()
    if q:
        params["q"] = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where = " and (u.full_name like %(q)s or u.email like %(q)s)"
    direction = "desc" if order == "desc" else "asc"
    total = frappe.db.sql(f"select count(*) {_PANEL_FROM}{where}", params)[0][0]
    rows = frappe.db.sql(
        f"{_PANEL_COLUMNS} {_PANEL_FROM}{where} order by {SORTS[sort or 'createdAt']} {direction}, u.name asc "
        f"limit {int(page_size)} offset {int(offset)}",
        params, as_dict=True,
    )
    return page_of([_listed(r) for r in rows], total, page, page_size)


def _set_panel_role(doc, role: str) -> None:
    doc.set("roles", [r for r in doc.roles if r.role not in PANEL_ROLES])
    doc.append("roles", {"role": ROLE_OF[role]})


@frappe.whitelist(methods=["POST"])
def create(full_name: str | None = None, email: str | None = None, role: str | None = None,
           password: str | None = None) -> dict:
    """Add a godown user with a password, active at once — no email. An unaccepted invite for
    the email is taken over; its link stops working."""
    require_roles("admin", "godown_supervisor")
    full_name = (full_name or "").strip() if isinstance(full_name, str) else ""
    address = _clean_email(email)
    _check([
        None if full_name else ("name", "Name is required"),
        None if address else ("email", "Enter a valid email"),
        _enum("role", role, tuple(ROLE_OF)),
        _password_issue(password),
    ])
    acting = _acting()
    existing = _find_by_email(address)
    if existing:
        enabled = frappe.db.get_value("User", existing, "enabled")
        if _status(existing, enabled) != "invited":
            raise RTDuplicate(TAKEN)
        if not _panel_role(existing):
            raise RTForbidden(OUTSIDE)
        if acting == "godown_supervisor" and _panel_role(existing) != "godown_operator":
            raise RTForbidden("This email has a pending supervisor invite — only an admin can set its password")
        doc = frappe.get_doc("User", existing)
        doc.first_name, doc.last_name = full_name, ""
        _set_panel_role(doc, role)
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc({"doctype": "User", "email": address, "first_name": full_name, "enabled": 1,
                              "send_welcome_email": 0, "roles": [{"role": ROLE_OF[role]}]})
        doc.insert(ignore_permissions=True)
    _set_password(doc.name, password)
    return _row(doc.name)


@frappe.whitelist(methods=["POST"])
def set_password(user: str | None = None, password: str | None = None) -> dict:
    """Replace a godown user's password; the old one isn't asked for. A supervisor may only do
    this for operators. A pending invite becomes active."""
    require_roles("admin", "godown_supervisor")
    _check([_password_issue(password)])
    target = _target(user)
    role = _panel_role(target.name)
    if not role:
        raise RTForbidden(OUTSIDE)
    if _acting() == "godown_supervisor" and role != "godown_operator":
        raise RTForbidden("Supervisors can only set an operator's password")
    _set_password(target.name, password)
    return {"id": target.name, "status": _status(target.name, target.enabled)}


@frappe.whitelist(methods=["POST"])
def invite(full_name: str | None = None, email: str | None = None, role: str | None = None) -> dict:
    """Make (or renew) a pending godown account and email it a link to set its password."""
    require_roles("admin", "godown_supervisor")
    full_name = (full_name or "").strip() if isinstance(full_name, str) else ""
    address = _clean_email(email)
    _check([
        None if full_name else ("name", "Name is required"),
        None if address else ("email", "Invalid email"),
        _enum("role", role, tuple(ROLE_OF)),
    ])
    if _acting() == "godown_supervisor" and role != "godown_operator":
        raise RTForbidden("Godown supervisors can only invite godown operators")
    existing = _find_by_email(address)
    if existing:
        if _status(existing, frappe.db.get_value("User", existing, "enabled")) != "invited":
            raise RTDuplicate(TAKEN)
        if not _panel_role(existing):
            raise RTForbidden(OUTSIDE)
        doc = frappe.get_doc("User", existing)
        doc.first_name, doc.last_name = full_name, ""
        _set_panel_role(doc, role)
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc({"doctype": "User", "email": address, "first_name": full_name, "enabled": 1,
                              "send_welcome_email": 0, "roles": [{"role": ROLE_OF[role]}]})
        doc.insert(ignore_permissions=True)
    key = _issue_key(doc.name, INVITE)
    _send_link(
        doc.email, "You've been invited to Royale Touche", f"{_portal_url()}/accept-invite/{key}",
        f"<p>Hi {escape_html(full_name)},</p><p>You've been invited to join Royale Touche. Use the link below "
        "to set your password and get started. This link expires in 7 days.</p>",
    )
    return _row(doc.name)


@frappe.whitelist(methods=["POST"])
def update(user: str | None = None, role: str | None = None, status: str | None = None) -> dict:
    """Change a godown account's role and/or status. A supervisor may edit operators only."""
    require_roles("admin", "godown_supervisor")
    _check([_enum("role", role, tuple(ROLE_OF), required=False), _enum("status", status, STATUSES, required=False)])
    if not role and not status:
        raise RTValidation("Provide role and/or status to update")
    target = _target(user)
    if rt_role(target.name) == "super_admin":
        raise RTForbidden(SUPER)
    current = _panel_role(target.name)
    if not current:
        raise RTForbidden(OUTSIDE)
    if _acting() == "godown_supervisor" and current != "godown_operator":
        raise RTForbidden("Supervisors can only edit operators")
    if status == "invited" and _has_password(target.name):
        # "invited" means no password yet; there's no taking one away from here.
        raise RTValidation("An account that has a password can't be set back to invited")
    doc = frappe.get_doc("User", target.name)
    if role:
        _set_panel_role(doc, role)
    if status:
        doc.enabled = 0 if status == "suspended" else 1
        if status == "suspended":
            doc.update(_no_key())  # a link already sent must not outlive the suspension
    doc.save(ignore_permissions=True)
    return _row(doc.name)


@frappe.whitelist(methods=["POST"])
def remove(user: str | None = None) -> dict:
    """Admin-only. Node never deleted an account: it suspends it."""
    require_roles("admin")
    if user and user == frappe.session.user:
        raise RTValidation("You cannot delete your own account")
    target = _target(user)
    if rt_role(target.name) == "super_admin":
        raise RTForbidden(SUPER)
    if not _panel_role(target.name):
        raise RTForbidden(OUTSIDE)
    doc = frappe.get_doc("User", target.name)
    doc.enabled = 0
    doc.update(_no_key())
    doc.save(ignore_permissions=True)
    return {"id": doc.name, "status": "suspended"}


# ---- invite / forgot / reset (routes/auth.routes.ts), open to guests ----

@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=5 * 60)
def accept_invite(token: str | None = None, password: str | None = None) -> dict:
    """Set the password of a pending account from its invite link, and sign it in."""
    _check([_password_issue(password)])
    user = _user_for_key(token, INVITE)
    if not user or not _panel_role(user) or _has_password(user):
        raise RTValidation(BAD_INVITE)
    _set_password(user, password)
    return _issue(user)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=60 * 60)
def forgot_password(email: str | None = None) -> dict:
    """Email a reset link. The reply never tells whether the email has an account."""
    address = _clean_email(email)
    _check([None if address else ("email", "Invalid email")])
    try:
        user = _find_by_email(address)
        if user and user not in frappe.STANDARD_USERS and frappe.db.get_value("User", user, "enabled") and rt_role(user):
            key = _issue_key(user, RESET)
            _send_link(
                frappe.db.get_value("User", user, "email") or user, "Reset your Royale Touche password",
                f"{_portal_url()}/reset-password?token={key}",
                "<p>We received a request to reset your password.</p><p>If you didn't request this, you can "
                "ignore this email. This link expires in 1 hour.</p>",
            )
    except Exception:
        frappe.log_error("Password reset link could not be sent")
    frappe.clear_messages()
    return {"message": FORGOT_REPLY}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=5 * 60)
def reset_password(token: str | None = None, password: str | None = None) -> dict:
    """Set a new password from a reset link, and sign in. A pending invite becomes active."""
    _check([_password_issue(password)])
    user = _user_for_key(token, RESET)
    if not user:
        raise RTValidation(BAD_RESET)
    _set_password(user, password)
    return _issue(user)
