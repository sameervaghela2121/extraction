"""The admin portal's user management and invite / forgot / reset password flows, with the old
Node server's rules (backend/src/services/{users,auth}.service.ts, routes/users.routes.ts)."""

from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime
from frappe.utils.data import sha256_hash

from royal_touche.api import auth, portal_users as pu
from royal_touche.errors import RTDuplicate, RTForbidden, RTNotFound, RTValidation
from royal_touche.tests.factories import as_user, make_user
from royal_touche.tests.test_auth import authenticated_as

PASSWORD = "Rt-test-Pass-2026!"
NEW_PASSWORD = "Another-Pass-2026"
SEND_LINK = pu._send_link
SHAPE = {"id", "name", "email", "role", "status"}
NO_PERMISSION = "You do not have permission to perform this action"
OUTSIDE = "This account is managed outside this panel"
SUPER = "Super admin accounts can only be changed directly in the database"


def email(tag: str = "u") -> str:
    return f"probe-users-{tag}-{frappe.generate_hash(length=6)}@rt.localhost"


def with_password(role: str) -> str:
    user = make_user(role)
    frappe.utils.password.update_password(user, PASSWORD)
    return user


def has_password(user: str) -> bool:
    return bool(frappe.db.exists("__Auth", {"doctype": "User", "name": user, "fieldname": "password"}))


def link_key(user: str) -> frappe._dict:
    """What is stored of the user's emailed link: our own fields, never ERPNext's reset key."""
    return frappe.db.get_value("User", user, ["rt_link_key_hash", "rt_link_purpose", "rt_link_expires",
                                              "reset_password_key"], as_dict=True)


def expire_link(user: str, at) -> None:
    frappe.db.set_value("User", user, "rt_link_expires", at)


class LinkMail:
    """Captures the links the flows would email, instead of sending them."""

    def __init__(self):
        self.sent = []

    def __call__(self, recipient, subject, link, *_):
        self.sent.append((recipient, subject, link))

    def token(self, recipient):
        links = [link for to, _subject, link in self.sent if to == recipient]
        assert links, f"no link sent to {recipient}"
        last = links[-1]
        return last.split("token=")[-1] if "token=" in last else last.rsplit("/", 1)[-1]


class PortalUsersCase(IntegrationTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        frappe.local.request_ip = "198.51.100.7"
        frappe.cache.delete_keys("rl:")
        self.mail = LinkMail()
        patcher = patch.object(pu, "_send_link", self.mail)
        patcher.start()
        self.addCleanup(patcher.stop)
        # ERPNext refuses a 61st user made within a minute; this module makes a few per test.
        throttle = patch.dict(frappe.local.conf, {"throttle_user_limit": 10_000})
        throttle.start()
        self.addCleanup(throttle.stop)
        self.admin = with_password("RT Admin")
        self.supervisor = with_password("Godown Supervisor")
        self.operator = with_password("Godown Operator")
        self.super_admin = with_password("RT Super Admin")

    def tearDown(self):
        frappe.set_user("Administrator")

    def create(self, acting, role="godown_operator", **kw):
        args = {"full_name": "Probe User", "email": email(), "role": role, "password": PASSWORD, **kw}
        with as_user(acting):
            return pu.create(**args)

    def invite(self, acting, role="godown_operator", address=None, full_name="Invited Person"):
        with as_user(acting):
            return pu.invite(full_name=full_name, email=address or email("inv"), role=role)

    def refused(self, exc, message, fn, *args, acting=None, **kwargs):
        if acting:
            with as_user(acting), self.assertRaises(exc) as ctx:
                fn(*args, **kwargs)
        else:
            with self.assertRaises(exc) as ctx:
                fn(*args, **kwargs)
        self.assertEqual(str(ctx.exception), message)
        frappe.clear_messages()


class TestAccess(PortalUsersCase):
    def test_operators_cannot_reach_the_panel(self):
        target = make_user("Godown Operator")
        for fn, kwargs in (
            (pu.list_users, {}),
            (pu.search, {}),
            (pu.create, {"full_name": "X", "email": email(), "role": "godown_operator", "password": PASSWORD}),
            (pu.invite, {"full_name": "X", "email": email(), "role": "godown_operator"}),
            (pu.set_password, {"user": target, "password": PASSWORD}),
            (pu.update, {"user": target, "status": "suspended"}),
            (pu.remove, {"user": target}),
        ):
            self.refused(frappe.PermissionError, NO_PERMISSION, fn, acting=self.operator, **kwargs)
        self.assertEqual(frappe.db.get_value("User", target, "enabled"), 1)

    def test_only_admins_delete(self):
        target = make_user("Godown Operator")
        self.refused(frappe.PermissionError, NO_PERMISSION, pu.remove, acting=self.supervisor, user=target)
        with as_user(self.super_admin):
            self.assertEqual(pu.remove(user=target), {"id": target, "status": "suspended"})

    def test_a_user_with_no_rt_role_is_refused(self):
        outsider = make_user("Accounts User")
        self.refused(frappe.PermissionError, NO_PERMISSION, pu.list_users, acting=outsider)


class TestListAndSearch(PortalUsersCase):
    def test_only_godown_accounts_are_listed_for_every_caller(self):
        mixed = make_user("Godown Operator")
        frappe.get_doc("User", mixed).add_roles("Accounts User")
        for acting in (self.admin, self.supervisor, self.super_admin):
            with as_user(acting):
                rows = pu.list_users()
            ids = {r["id"] for r in rows}
            self.assertTrue({self.supervisor, self.operator} <= ids)
            self.assertFalse({self.admin, self.super_admin, "Administrator", "Guest", mixed} & ids)
            self.assertTrue(all(set(r) == SHAPE for r in rows))
            self.assertTrue(all(r["role"] in ("godown_supervisor", "godown_operator") for r in rows))

    def test_the_administrator_role_makes_an_account_an_outside_one(self):
        """ERPNext counts the Administrator role among its automatic ones; it isn't one a godown
        account may have."""
        mixed = with_password("Godown Operator")
        frappe.get_doc("User", mixed).add_roles("Administrator")
        with as_user(self.admin):
            self.assertNotIn(mixed, {r["id"] for r in pu.list_users()})
            self.assertEqual(pu.search(q=mixed)["items"], [])
        self.refused(RTForbidden, OUTSIDE, pu.update, user=mixed, status="suspended", acting=self.admin)
        self.refused(RTForbidden, OUTSIDE, pu.set_password, user=mixed, password=NEW_PASSWORD, acting=self.admin)
        self.refused(RTForbidden, OUTSIDE, pu.remove, user=mixed, acting=self.admin)
        self.assertEqual(frappe.db.get_value("User", mixed, "enabled"), 1)

    def test_list_is_oldest_first(self):
        with as_user(self.admin):
            rows = pu.list_users()
        creation = {r["id"]: frappe.db.get_value("User", r["id"], "creation") for r in rows}
        self.assertEqual([r["id"] for r in rows], sorted(creation, key=lambda u: (creation[u], u)))

    def test_status_mapping(self):
        tag = frappe.generate_hash(length=8)
        active = self.create(self.admin, email=f"probe-users-{tag}-a@rt.localhost")
        invited = self.invite(self.admin, address=f"probe-users-{tag}-b@rt.localhost")
        suspended = self.create(self.admin, email=f"probe-users-{tag}-c@rt.localhost")
        with as_user(self.admin):
            pu.update(user=suspended["id"], status="suspended")
            page = pu.search(q=tag, sort="email")
        self.assertEqual([(r["id"], r["status"]) for r in page["items"]],
                         [(active["id"], "active"), (invited["id"], "invited"), (suspended["id"], "suspended")])

    def test_search_filters_sorts_and_pages(self):
        tag = frappe.generate_hash(length=8)
        made = [self.create(self.admin, full_name=f"{name} {tag}", email=f"probe-users-{tag}-{i}@rt.localhost")
                for i, name in enumerate(["Charlie", "alpha", "Bravo"])]
        with as_user(self.supervisor):
            page = pu.search(q=tag, page=1, page_size=2, sort="name", order="desc")
            self.assertEqual(set(page), {"items", "total", "page", "pageSize", "totalPages"})
            self.assertEqual((page["total"], page["page"], page["pageSize"], page["totalPages"]), (3, 1, 2, 2))
            self.assertEqual([r["name"] for r in page["items"]], [f"Charlie {tag}", f"Bravo {tag}"])
            self.assertEqual([r["name"] for r in pu.search(q=tag, page=2, page_size=2, sort="name", order="desc")["items"]],
                             [f"alpha {tag}"])
            # Default: oldest first.
            self.assertEqual([r["id"] for r in pu.search(q=tag)["items"]], [m["id"] for m in made])
            # By email, part of an address.
            self.assertEqual([r["id"] for r in pu.search(q=f"{tag}-2@")["items"]], [made[2]["id"]])
            # LIKE wildcards are literal.
            self.assertEqual(pu.search(q=f"{tag}%")["total"], 0)
            self.assertEqual(pu.search(q="%")["total"], 0)

    def test_search_rejects_unknown_sort_and_long_queries(self):
        with as_user(self.admin):
            self.refused(RTValidation, "sort: Invalid enum value. Expected 'createdAt' | 'name' | 'email', received 'role'",
                         pu.search, sort="role")
            self.refused(RTValidation, "order: Invalid enum value. Expected 'asc' | 'desc', received 'up'",
                         pu.search, order="up")
            self.refused(RTValidation, "q: String must contain at most 100 character(s)", pu.search, q="x" * 101)


class TestCreate(PortalUsersCase):
    def test_admin_adds_an_active_user_who_can_log_in(self):
        address = email("Mixed")
        res = self.create(self.admin, role="godown_supervisor", full_name="  New Supervisor ", email=f" {address.upper()} ")
        self.assertEqual(res, {"id": address.lower(), "name": "New Supervisor", "email": address.lower(),
                               "role": "godown_supervisor", "status": "active"})
        self.assertEqual(frappe.get_roles(res["id"]).count("Godown Supervisor"), 1)
        frappe.set_user("Guest")
        self.assertEqual(auth.login(usr=res["email"], pwd=PASSWORD)["role"], "godown_supervisor")
        self.assertEqual(self.mail.sent, [])

    def test_a_supervisor_may_add_either_godown_role(self):
        self.assertEqual(self.create(self.supervisor, role="godown_supervisor")["role"], "godown_supervisor")
        self.assertEqual(self.create(self.supervisor, role="godown_operator")["role"], "godown_operator")

    def test_no_other_role_can_be_granted(self):
        for role in ("admin", "super_admin", "staff", "store_manager", "RT Admin", "System Manager"):
            for acting in (self.admin, self.super_admin, self.supervisor):
                self.refused(RTValidation,
                             f"role: Invalid enum value. Expected 'godown_supervisor' | 'godown_operator', received '{role}'",
                             self.create, acting, role=role)

    def test_validation_messages(self):
        self.refused(RTValidation, "Name is required", self.create, self.admin, full_name="  ")
        self.refused(RTValidation, "Enter a valid email", self.create, self.admin, email="not-an-email")
        self.refused(RTValidation, "Password must be at least 8 characters", self.create, self.admin, password="short")
        self.refused(RTValidation, "password: String must contain at most 128 character(s)",
                     self.create, self.admin, password="x" * 129)

    def test_an_email_in_use_is_refused(self):
        self.refused(RTDuplicate, "A user with this email already exists", self.create, self.admin, email=self.operator)
        self.refused(RTDuplicate, "A user with this email already exists", self.create, self.admin, email=self.admin)
        suspended = self.create(self.admin)
        with as_user(self.admin):
            pu.update(user=suspended["id"], status="suspended")
        self.refused(RTDuplicate, "A user with this email already exists", self.create, self.admin, email=suspended["id"])

    def test_a_pending_invite_is_taken_over(self):
        invited = self.invite(self.admin, role="godown_operator")
        old_token = self.mail.token(invited["email"])
        res = self.create(self.supervisor, role="godown_supervisor", full_name="Renamed", email=invited["email"])
        self.assertEqual((res["id"], res["name"], res["role"], res["status"]),
                         (invited["id"], "Renamed", "godown_supervisor", "active"))
        self.assertNotIn("Godown Operator", frappe.get_roles(res["id"]))
        frappe.set_user("Guest")
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token=old_token, password=NEW_PASSWORD)
        self.assertTrue(auth.login(usr=res["id"], pwd=PASSWORD)["access_token"])

    def test_a_supervisor_cannot_take_over_a_pending_supervisor(self):
        invited = self.invite(self.admin, role="godown_supervisor")
        self.refused(RTForbidden, "This email has a pending supervisor invite — only an admin can set its password",
                     self.create, self.supervisor, email=invited["email"])

    def test_a_pending_account_outside_the_panel_is_not_taken_over(self):
        outsider = make_user("Accounts User")  # no password: pending
        self.refused(RTForbidden, OUTSIDE, self.create, self.admin, email=outsider)
        self.assertFalse(has_password(outsider))


class TestSetPassword(PortalUsersCase):
    def set(self, acting, user, password=NEW_PASSWORD):
        with as_user(acting):
            return pu.set_password(user=user, password=password)

    def test_admin_sets_any_godown_password(self):
        self.assertEqual(self.set(self.admin, self.supervisor), {"id": self.supervisor, "status": "active"})
        frappe.set_user("Guest")
        self.assertTrue(auth.login(usr=self.supervisor, pwd=NEW_PASSWORD)["access_token"])

    def test_it_activates_a_pending_invite_and_kills_its_link(self):
        invited = self.invite(self.admin)
        token = self.mail.token(invited["email"])
        self.assertEqual(self.set(self.supervisor, invited["id"]), {"id": invited["id"], "status": "active"})
        frappe.set_user("Guest")
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token=token, password=PASSWORD)

    def test_it_kills_a_pending_reset_link(self):
        frappe.set_user("Guest")
        pu.forgot_password(email=self.operator)
        token = self.mail.token(self.operator)
        self.set(self.admin, self.operator)
        frappe.set_user("Guest")
        self.refused(RTValidation, "This reset link is invalid or has expired", pu.reset_password, token=token, password=PASSWORD)

    def test_refusals(self):
        self.refused(RTForbidden, "Supervisors can only set an operator's password", self.set, self.supervisor, self.supervisor)
        other = make_user("Godown Supervisor")
        self.refused(RTForbidden, "Supervisors can only set an operator's password", self.set, self.supervisor, other)
        self.refused(RTForbidden, OUTSIDE, self.set, self.admin, self.admin)
        self.refused(RTForbidden, OUTSIDE, self.set, self.super_admin, self.super_admin)
        self.refused(RTForbidden, OUTSIDE, self.set, self.supervisor, "Administrator")
        self.refused(RTNotFound, "User not found", self.set, self.admin, "nobody-here@rt.localhost")
        self.refused(RTValidation, "Password must be at least 8 characters", self.set, self.admin, self.operator, "short")
        self.assertTrue(self.set(self.supervisor, self.operator))


class TestInviteAndAccept(PortalUsersCase):
    def test_invite_then_accept_then_log_in(self):
        address = email("inv")
        res = self.invite(self.supervisor, address=address.upper(), full_name="Ravi Kumar")
        self.assertEqual(res, {"id": address, "name": "Ravi Kumar", "email": address,
                               "role": "godown_operator", "status": "invited"})
        self.assertFalse(has_password(address))
        (to, subject, link), = self.mail.sent
        self.assertEqual((to, subject), (address, "You've been invited to Royale Touche"))
        self.assertRegex(link, r"^https?://[^/]+/accept-invite/[0-9a-f]{20,}$")
        token = self.mail.token(address)
        # The key is stored hashed, never as sent, and never as ERPNext's own reset key.
        stored = link_key(address)
        self.assertEqual((stored.rt_link_key_hash, stored.rt_link_purpose), (sha256_hash(token), "invite"))
        self.assertNotEqual(stored.rt_link_key_hash, token)
        self.assertFalse(stored.reset_password_key)

        frappe.set_user("Guest")
        with self.assertRaises(frappe.AuthenticationError):
            auth.login(usr=address, pwd=PASSWORD)
        frappe.clear_messages()
        result = pu.accept_invite(token=token, password=PASSWORD)
        self.assertEqual((result["user"], result["full_name"], result["role"]), (address, "Ravi Kumar", "godown_operator"))
        self.assertEqual(authenticated_as(result["access_token"]), address)
        frappe.set_user("Guest")
        self.assertTrue(auth.login(usr=address, pwd=PASSWORD)["access_token"])
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token=token, password=NEW_PASSWORD)
        self.assertFalse(link_key(address).rt_link_key_hash)

    def test_a_supervisor_invites_operators_only(self):
        self.refused(RTForbidden, "Godown supervisors can only invite godown operators",
                     self.invite, self.supervisor, role="godown_supervisor")
        self.assertEqual(self.invite(self.admin, role="godown_supervisor")["role"], "godown_supervisor")

    def test_no_other_role_can_be_invited(self):
        for role in ("admin", "super_admin", "staff", "store_manager"):
            self.refused(RTValidation,
                         f"role: Invalid enum value. Expected 'godown_supervisor' | 'godown_operator', received '{role}'",
                         self.invite, self.super_admin, role=role)

    def test_invite_validation(self):
        self.refused(RTValidation, "Name is required", self.invite, self.admin, full_name="")
        self.refused(RTValidation, "Invalid email", self.invite, self.admin, address="nope")

    def test_existing_accounts(self):
        self.refused(RTDuplicate, "A user with this email already exists", self.invite, self.admin, address=self.operator)
        self.refused(RTDuplicate, "A user with this email already exists", self.invite, self.admin, address=self.admin)
        outsider = make_user("Accounts User")
        self.refused(RTForbidden, OUTSIDE, self.invite, self.admin, address=outsider)

    def test_inviting_again_renews_the_link(self):
        first = self.invite(self.admin, role="godown_supervisor", full_name="First")
        old = self.mail.token(first["email"])
        again = self.invite(self.admin, role="godown_operator", address=first["email"], full_name="Second")
        self.assertEqual((again["id"], again["name"], again["role"], again["status"]),
                         (first["id"], "Second", "godown_operator", "invited"))
        self.assertNotIn("Godown Supervisor", frappe.get_roles(first["id"]))
        new = self.mail.token(first["email"])
        frappe.set_user("Guest")
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token=old, password=PASSWORD)
        self.assertEqual(pu.accept_invite(token=new, password=PASSWORD)["role"], "godown_operator")

    def test_an_invite_expires_after_seven_days(self):
        before = now_datetime()
        invited = self.invite(self.admin)
        token = self.mail.token(invited["email"])
        expires = link_key(invited["id"]).rt_link_expires
        self.assertTrue(before + timedelta(days=7) <= expires <= now_datetime() + timedelta(days=7))
        expire_link(invited["id"], now_datetime() - timedelta(minutes=1))
        frappe.set_user("Guest")
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token=token, password=PASSWORD)
        expire_link(invited["id"], now_datetime() + timedelta(hours=1))
        self.assertTrue(pu.accept_invite(token=token, password=PASSWORD)["access_token"])

    def test_an_invite_link_is_not_a_reset_link(self):
        invited = self.invite(self.admin)
        token = self.mail.token(invited["email"])
        frappe.set_user("Guest")
        self.refused(RTValidation, "This reset link is invalid or has expired", pu.reset_password, token=token, password=PASSWORD)
        self.assertFalse(has_password(invited["id"]))
        self.assertTrue(pu.accept_invite(token=token, password=PASSWORD)["access_token"])

    def test_a_reset_link_is_not_an_invite_link(self):
        invited = self.invite(self.admin)
        frappe.set_user("Guest")
        pu.forgot_password(email=invited["email"])
        token = self.mail.token(invited["email"])
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token=token, password=PASSWORD)
        self.assertFalse(has_password(invited["id"]))

    def test_a_suspended_invite_cannot_be_accepted(self):
        invited = self.invite(self.admin)
        token = self.mail.token(invited["email"])
        with as_user(self.admin):
            self.assertEqual(pu.remove(user=invited["id"])["status"], "suspended")
        frappe.set_user("Guest")
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token=token, password=PASSWORD)
        self.assertEqual(frappe.db.get_value("User", invited["id"], "enabled"), 0)
        self.assertFalse(has_password(invited["id"]))
        self.assertFalse(link_key(invited["id"]).rt_link_key_hash)

    def test_accept_validation(self):
        invited = self.invite(self.admin)
        token = self.mail.token(invited["email"])
        frappe.set_user("Guest")
        self.refused(RTValidation, "Password must be at least 8 characters", pu.accept_invite, token=token, password="short")
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token="", password=PASSWORD)
        self.refused(RTValidation, "This invite is invalid or has expired", pu.accept_invite, token="nope", password=PASSWORD)
        self.assertFalse(has_password(invited["id"]))


class TestUpdate(PortalUsersCase):
    def update(self, acting, user, **kw):
        with as_user(acting):
            return pu.update(user=user, **kw)

    def test_admin_changes_role_and_suspends(self):
        res = self.update(self.admin, self.operator, role="godown_supervisor", status="suspended")
        self.assertEqual(set(res), SHAPE)
        self.assertEqual((res["id"], res["role"], res["status"]), (self.operator, "godown_supervisor", "suspended"))
        roles = frappe.get_roles(self.operator)
        self.assertIn("Godown Supervisor", roles)
        self.assertNotIn("Godown Operator", roles)
        self.assertEqual(frappe.db.get_value("User", self.operator, "enabled"), 0)
        frappe.set_user("Guest")
        self.refused(frappe.AuthenticationError, auth.SUSPENDED, auth.login, usr=self.operator, pwd=PASSWORD)
        res = self.update(self.admin, self.operator, status="active")
        self.assertEqual((res["role"], res["status"]), ("godown_supervisor", "active"))
        frappe.set_user("Guest")
        self.assertEqual(auth.login(usr=self.operator, pwd=PASSWORD)["role"], "godown_supervisor")

    def test_suspending_kills_a_pending_reset_link(self):
        frappe.set_user("Guest")
        pu.forgot_password(email=self.operator)
        token = self.mail.token(self.operator)
        self.update(self.admin, self.operator, status="suspended")
        self.assertFalse(link_key(self.operator).rt_link_key_hash)
        self.update(self.admin, self.operator, status="active")
        frappe.set_user("Guest")
        self.refused(RTValidation, "This reset link is invalid or has expired", pu.reset_password, token=token, password=NEW_PASSWORD)

    def test_a_supervisor_edits_operators_only(self):
        # Node allowed a supervisor to make an operator a supervisor (updateUserSchema, update()).
        res = self.update(self.supervisor, self.operator, role="godown_supervisor")
        self.assertEqual(res["role"], "godown_supervisor")
        self.refused(RTForbidden, "Supervisors can only edit operators", self.update, self.supervisor, self.operator,
                     status="suspended")
        self.refused(RTForbidden, "Supervisors can only edit operators", self.update, self.supervisor, self.supervisor,
                     role="godown_operator")

    def test_accounts_outside_the_panel(self):
        self.refused(RTForbidden, SUPER, self.update, self.admin, self.super_admin, status="suspended")
        self.refused(RTForbidden, SUPER, self.update, self.admin, "Administrator", status="suspended")
        self.refused(RTForbidden, OUTSIDE, self.update, self.admin, self.admin, role="godown_operator")
        self.refused(RTForbidden, OUTSIDE, self.update, self.super_admin, make_user("RT Admin"), status="suspended")
        self.refused(RTNotFound, "User not found", self.update, self.admin, "nobody-here@rt.localhost", status="active")
        self.assertEqual(frappe.db.get_value("User", self.super_admin, "enabled"), 1)
        self.assertIn("RT Admin", frappe.get_roles(self.admin))

    def test_validation(self):
        self.refused(RTValidation, "Provide role and/or status to update", self.update, self.admin, self.operator)
        for role in ("admin", "super_admin"):
            self.refused(RTValidation,
                         f"role: Invalid enum value. Expected 'godown_supervisor' | 'godown_operator', received '{role}'",
                         self.update, self.super_admin, self.operator, role=role)
        self.refused(RTValidation, "status: Invalid enum value. Expected 'invited' | 'active' | 'suspended', received 'gone'",
                     self.update, self.admin, self.operator, status="gone")
        self.refused(RTValidation, "An account that has a password can't be set back to invited",
                     self.update, self.admin, self.operator, status="invited")
        self.assertEqual(frappe.get_roles(self.operator).count("Godown Operator"), 1)

    def test_a_pending_invite_stays_invited(self):
        invited = self.invite(self.admin)
        self.assertEqual(self.update(self.admin, invited["id"], status="invited")["status"], "invited")
        self.assertEqual(self.update(self.admin, invited["id"], status="active")["status"], "invited")
        self.assertEqual(self.update(self.admin, invited["id"], status="suspended")["status"], "suspended")


class TestRemove(PortalUsersCase):
    def test_remove_suspends(self):
        with as_user(self.admin):
            self.assertEqual(pu.remove(user=self.operator), {"id": self.operator, "status": "suspended"})
        self.assertTrue(frappe.db.exists("User", self.operator))
        self.assertEqual(frappe.db.get_value("User", self.operator, "enabled"), 0)

    def test_refusals(self):
        with as_user(self.admin):
            self.refused(RTValidation, "You cannot delete your own account", pu.remove, user=self.admin)
            self.refused(RTNotFound, "User not found", pu.remove, user="nobody-here@rt.localhost")
            self.refused(RTForbidden, SUPER, pu.remove, user=self.super_admin)
            self.refused(RTForbidden, OUTSIDE, pu.remove, user=make_user("RT Admin"))
        with as_user(self.super_admin):
            self.refused(RTValidation, "You cannot delete your own account", pu.remove, user=self.super_admin)


class TestForgotAndReset(PortalUsersCase):
    GENERIC = {"message": "If that email exists, a reset link has been sent."}

    def test_reset_flow(self):
        frappe.set_user("Guest")
        self.assertEqual(pu.forgot_password(email=f" {self.supervisor.upper()} "), self.GENERIC)
        (to, subject, link), = self.mail.sent
        self.assertEqual((to, subject), (self.supervisor, "Reset your Royale Touche password"))
        self.assertRegex(link, r"^https?://[^/]+/reset-password\?token=[0-9a-f]{20,}$")
        token = self.mail.token(self.supervisor)
        result = pu.reset_password(token=token, password=NEW_PASSWORD)
        self.assertEqual((result["user"], result["role"]), (self.supervisor, "godown_supervisor"))
        self.assertEqual(authenticated_as(result["access_token"]), self.supervisor)
        frappe.set_user("Guest")
        self.assertTrue(auth.login(usr=self.supervisor, pwd=NEW_PASSWORD)["access_token"])
        self.refused(RTValidation, "This reset link is invalid or has expired", pu.reset_password, token=token, password=PASSWORD)

    def test_no_email_enumeration(self):
        outsider = with_password("Accounts User")
        suspended = with_password("Godown Operator")
        frappe.db.set_value("User", suspended, "enabled", 0)
        frappe.set_user("Guest")
        for address in ("nobody-here@rt.localhost", suspended, outsider, "admin@example.com", "guest@example.com"):
            self.assertEqual(pu.forgot_password(email=address), self.GENERIC)
        self.assertEqual(self.mail.sent, [])
        for user in (suspended, outsider, "Administrator"):
            self.assertFalse(frappe.db.get_value("User", user, "reset_password_key"))
            self.assertFalse(link_key(user).rt_link_key_hash)
        self.assertEqual(frappe.local.message_log, [])

    def test_a_delivery_failure_is_not_revealed(self):
        frappe.set_user("Guest")
        with patch.object(pu, "_send_link", side_effect=frappe.OutgoingEmailError("smtp down")):
            self.assertEqual(pu.forgot_password(email=self.operator), self.GENERIC)

    def test_forgot_validation(self):
        frappe.set_user("Guest")
        self.refused(RTValidation, "Invalid email", pu.forgot_password, email="nope")

    def test_a_reset_link_expires_after_an_hour(self):
        before = now_datetime()
        frappe.set_user("Guest")
        pu.forgot_password(email=self.operator)
        token = self.mail.token(self.operator)
        stored = link_key(self.operator)
        self.assertEqual(stored.rt_link_purpose, "reset")
        self.assertTrue(before + timedelta(hours=1) <= stored.rt_link_expires <= now_datetime() + timedelta(hours=1))
        expire_link(self.operator, now_datetime() - timedelta(minutes=1))
        self.refused(RTValidation, "This reset link is invalid or has expired", pu.reset_password, token=token, password=NEW_PASSWORD)
        expire_link(self.operator, now_datetime() + timedelta(minutes=10))
        self.assertTrue(pu.reset_password(token=token, password=NEW_PASSWORD)["access_token"])

    def test_portal_links_do_not_work_on_erpnexts_own_reset(self):
        """ERPNext's guest update_password takes User.reset_password_key with no expiry and none
        of the portal's checks. Portal links must never be one."""
        from frappe.core.doctype.user.user import update_password as erpnext_update_password

        invited = self.invite(self.admin)
        frappe.set_user("Guest")
        pu.forgot_password(email=self.operator)
        for user, token in ((invited["id"], self.mail.token(invited["email"])), (self.operator, self.mail.token(self.operator))):
            self.assertFalse(frappe.db.get_value("User", user, "reset_password_key"))
            reply = erpnext_update_password(new_password="Xy7-unguessable-Pass-2026", key=token)
            self.assertEqual(reply, "The reset password link has either been used before or is invalid")
            frappe.local.response.pop("http_status_code", None)
        self.assertFalse(has_password(invited["id"]))
        self.assertTrue(auth.login(usr=self.operator, pwd=PASSWORD)["access_token"])

    def test_reset_activates_a_pending_invite(self):
        invited = self.invite(self.admin)
        frappe.set_user("Guest")
        pu.forgot_password(email=invited["email"])
        result = pu.reset_password(token=self.mail.token(invited["email"]), password=NEW_PASSWORD)
        self.assertEqual(result["user"], invited["id"])
        with as_user(self.admin):
            self.assertEqual(pu.search(q=invited["email"])["items"][0]["status"], "active")

    def test_a_suspended_user_cannot_reset(self):
        frappe.set_user("Guest")
        pu.forgot_password(email=self.operator)
        token = self.mail.token(self.operator)
        frappe.db.set_value("User", self.operator, "enabled", 0)
        self.refused(RTValidation, "This reset link is invalid or has expired", pu.reset_password, token=token, password=NEW_PASSWORD)

    def test_reset_validation(self):
        frappe.set_user("Guest")
        pu.forgot_password(email=self.operator)
        token = self.mail.token(self.operator)
        self.refused(RTValidation, "Password must be at least 8 characters", pu.reset_password, token=token, password="short")
        self.refused(RTValidation, "This reset link is invalid or has expired", pu.reset_password, token="", password=PASSWORD)
        self.assertTrue(pu.reset_password(token=token, password=NEW_PASSWORD)["access_token"])


class TestDelivery(PortalUsersCase):
    def test_links_point_at_the_portal(self):
        with patch.dict(frappe.conf, {"rt_portal_url": "https://portal.example.com/"}):
            self.invite(self.admin, address="probe-users-portal@rt.localhost")
            frappe.set_user("Guest")
            pu.forgot_password(email=self.operator)
        self.assertTrue(self.mail.sent[0][2].startswith("https://portal.example.com/accept-invite/"))
        self.assertTrue(self.mail.sent[1][2].startswith("https://portal.example.com/reset-password?token="))

    def test_the_email_is_queued(self):
        address = email("q")
        with patch.object(frappe, "sendmail") as sendmail:
            SEND_LINK(address, "Subject", "https://portal.example.com/accept-invite/abc")
        kwargs = sendmail.call_args.kwargs
        self.assertEqual((kwargs["recipients"], kwargs["subject"]), ([address], "Subject"))
        self.assertIn('href="https://portal.example.com/accept-invite/abc"', kwargs["message"])


class TestUnsentMail(IntegrationTestCase):
    """With no outgoing email account the link may go to the log only on a developer machine:
    on a server the log is read by people who must never hold someone else's reset key."""

    LINK = "https://portal.example/reset-password?token=SECRET-KEY-123"

    def send(self, developer_mode: int):
        logger = patch("frappe.logger").start()
        self.addCleanup(patch.stopall)
        patch("frappe.sendmail", side_effect=frappe.OutgoingEmailError("no account")).start()
        patch.dict(frappe.conf, {"developer_mode": developer_mode}).start()
        return logger.return_value

    def logged(self, log) -> str:
        return " ".join(str(c) for c in log.mock_calls)

    def test_a_server_never_logs_the_link(self):
        log = self.send(developer_mode=0)
        with self.assertRaises(RTValidation) as caught:
            SEND_LINK("someone@rt.localhost", "Reset your password", self.LINK)
        self.assertNotIn("SECRET-KEY-123", self.logged(log))
        self.assertIn("could not be sent", str(caught.exception))

    def test_a_developer_machine_logs_the_link(self):
        log = self.send(developer_mode=1)
        SEND_LINK("someone@rt.localhost", "Reset your password", self.LINK)
        self.assertIn("SECRET-KEY-123", self.logged(log))


class TestOldLinksRetired(IntegrationTestCase):
    def test_migrate_clears_reset_keys_the_old_flow_left_on_rt_accounts(self):
        """Before the portal had its own key, its links were ERPNext reset keys: still live on
        ERPNext's own endpoint. The patch retires them on RT accounts only."""
        from royal_touche.patches.clear_portal_reset_keys import execute

        godown, outsider = make_user("Godown Operator"), make_user("Accounts User")
        for user in (godown, outsider):
            frappe.db.set_value("User", user, "reset_password_key", sha256_hash(frappe.generate_hash()))
        execute()
        self.assertFalse(frappe.db.get_value("User", godown, "reset_password_key"))
        self.assertTrue(frappe.db.get_value("User", outsider, "reset_password_key"))
