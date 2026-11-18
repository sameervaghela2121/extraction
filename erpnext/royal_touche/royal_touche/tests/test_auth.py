"""App login: ERPNext checks the password; tokens are ERPNext OAuth Bearer Tokens, so ERPNext's own
validate_oauth authenticates every request (user's choice, Option B)."""

from datetime import timedelta

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from royal_touche.api import auth
from royal_touche.tests.factories import make_user

PASSWORD = "Rt-test-Pass-2026!"


def authenticated_as(token: str) -> str:
    """Run ERPNext's own bearer check, as a request carrying this token would."""
    from frappe.auth import validate_oauth
    from frappe.utils import set_request

    set_request(path="/api/method/royal_touche.api.auth.me", method="GET",
                headers={"Authorization": f"Bearer {token}"})
    frappe.set_user("Guest")
    validate_oauth(["Bearer", token])
    return frappe.session.user


class TestAppLogin(IntegrationTestCase):
    def setUp(self):
        self.user = make_user("Godown Operator")
        frappe.utils.password.update_password(self.user, PASSWORD)
        frappe.set_user("Guest")
        # A real request always carries the caller's address; the rate limiter keys on it.
        frappe.local.request_ip = "198.51.100.1"
        frappe.cache.delete_keys("rl:")

    def tearDown(self):
        frappe.set_user("Administrator")

    def login(self, pwd=PASSWORD, usr=None):
        return auth.login(usr=usr or self.user, pwd=pwd)

    def test_login_returns_tokens_and_role(self):
        res = self.login()
        self.assertEqual((res["user"], res["role"], res["expires_in"]), (self.user, "godown_operator", 3600))
        self.assertTrue(res["access_token"] and res["refresh_token"])
        self.assertNotEqual(res["access_token"], res["refresh_token"])

    def test_erpnext_accepts_the_access_token(self):
        token = self.login()["access_token"]
        self.assertEqual(authenticated_as(token), self.user)

    def test_wrong_password_or_disabled_user_is_refused(self):
        before = frappe.db.count("OAuth Bearer Token")
        with self.assertRaisesRegex(frappe.AuthenticationError, "Invalid email or password"):
            self.login(pwd="wrong")
        frappe.db.set_value("User", self.user, "enabled", 0)
        with self.assertRaises(frappe.AuthenticationError):
            self.login()
        self.assertEqual(frappe.db.count("OAuth Bearer Token"), before)

    def test_user_without_an_rt_role_cannot_log_in(self):
        outsider = make_user("Accounts User")
        frappe.utils.password.update_password(outsider, PASSWORD)
        with self.assertRaisesRegex(frappe.AuthenticationError, "You do not have access to the Royale Touche app"):
            self.login(usr=outsider)

    def test_refresh_gives_a_new_access_token_and_retires_the_old(self):
        first = self.login()
        second = auth.refresh(refresh_token=first["refresh_token"])
        self.assertNotEqual(second["access_token"], first["access_token"])
        self.assertEqual(authenticated_as(second["access_token"]), self.user)
        self.assertEqual(authenticated_as(first["access_token"]), "Guest")

    def test_a_refresh_whose_reply_was_lost_can_be_repeated(self):
        """The server has answered, the network dropped the reply, the app still holds the same
        refresh token. It must not be logged out for that."""
        first = self.login()
        auth.refresh(refresh_token=first["refresh_token"])
        again = auth.refresh(refresh_token=first["refresh_token"])
        self.assertEqual(again["refresh_token"], first["refresh_token"])
        self.assertEqual(authenticated_as(again["access_token"]), self.user)
        self.assertEqual(frappe.db.count("OAuth Bearer Token", {"refresh_token": first["refresh_token"], "status": "Active"}), 1)

    def test_refresh_is_refused_when_unknown_unused_for_30_days_or_user_disabled(self):
        with self.assertRaises(frappe.AuthenticationError):
            auth.refresh(refresh_token="nope")
        old = self.login()
        name = frappe.db.get_value("OAuth Bearer Token", {"refresh_token": old["refresh_token"]})
        frappe.db.set_value("OAuth Bearer Token", name, "modified", now_datetime() - timedelta(days=31),
                            update_modified=False)
        with self.assertRaises(frappe.AuthenticationError):
            auth.refresh(refresh_token=old["refresh_token"])
        fresh = self.login()
        frappe.db.set_value("User", self.user, "enabled", 0)
        with self.assertRaises(frappe.AuthenticationError):
            auth.refresh(refresh_token=fresh["refresh_token"])

    def test_an_expired_access_token_is_refused(self):
        token = self.login()["access_token"]
        frappe.db.set_value("OAuth Bearer Token", token, "expiration_time", now_datetime() - timedelta(seconds=1))
        self.assertEqual(authenticated_as(token), "Guest")

    def test_logout_ends_this_tablets_session_only(self):
        from frappe.utils import set_request

        tablet1, tablet2 = self.login(), self.login()
        set_request(path="/api/method/royal_touche.api.auth.logout", method="POST",
                    headers={"Authorization": f"Bearer {tablet1['access_token']}"})
        frappe.set_user(self.user)
        auth.logout()
        self.assertEqual(authenticated_as(tablet1["access_token"]), "Guest")
        with self.assertRaises(frappe.AuthenticationError):
            auth.refresh(refresh_token=tablet1["refresh_token"])
        self.assertEqual(authenticated_as(tablet2["access_token"]), self.user)

    def test_messages_reach_the_client_in_production(self):
        """Without developer mode ERPNext sends only _server_messages, never the exception text."""
        frappe.clear_messages()
        with self.assertRaises(frappe.AuthenticationError):
            self.login(pwd="wrong")
        self.assertEqual([m["message"] for m in frappe.get_message_log()], ["Invalid email or password"])

    def test_a_disabled_user_is_told_so(self):
        frappe.db.set_value("User", self.user, "enabled", 0)
        with self.assertRaisesRegex(frappe.AuthenticationError, "Your account has been suspended"):
            self.login()

    def test_a_wrong_password_never_reveals_that_an_account_is_suspended(self):
        frappe.db.set_value("User", self.user, "enabled", 0)
        with self.assertRaisesRegex(frappe.AuthenticationError, "Invalid email or password"):
            self.login(pwd="wrong")

    def test_logout_ends_every_token_of_this_tablets_session(self):
        from frappe.utils import set_request

        res = self.login()
        # Two refreshes racing can leave a second active token on one refresh token.
        extra = auth._issue(self.user, res["refresh_token"])
        set_request(path="/api/method/royal_touche.api.auth.logout", method="POST",
                    headers={"Authorization": f"Bearer {res['access_token']}"})
        frappe.set_user(self.user)
        auth.logout()
        self.assertEqual(authenticated_as(extra["access_token"]), "Guest")
        with self.assertRaises(frappe.AuthenticationError):
            auth.refresh(refresh_token=res["refresh_token"])

    def test_login_and_refresh_are_open_to_guests(self):
        for fn in (auth.login, auth.refresh):
            self.assertIn(fn, frappe.guest_methods)

    def test_the_eleventh_attempt_in_five_minutes_is_blocked(self):
        from frappe.utils import set_request

        frappe.cache.delete_keys("rl:")
        self.addCleanup(frappe.cache.delete_keys, "rl:")
        set_request(path="/api/method/royal_touche.api.auth.login", method="POST")
        frappe.local.request_ip = "203.0.113.7"
        for _ in range(10):
            with self.assertRaises(frappe.AuthenticationError):
                self.login(pwd="wrong")
        with self.assertRaises(frappe.RateLimitExceededError):
            self.login(pwd="wrong")
