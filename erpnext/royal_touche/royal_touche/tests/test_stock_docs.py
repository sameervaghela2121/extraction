import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.stock_docs import as_system
from royal_touche.tests.factories import as_user, make_user


class TestAsSystem(IntegrationTestCase):
    def test_the_request_context_comes_back_exactly(self):
        user = make_user("Godown Operator")
        with as_user(user):
            frappe.local.session.sid = "real-session-id"
            frappe.local.session.data = frappe._dict(csrf_token="tok")
            frappe.local.form_dict = frappe._dict(cmd="royal_touche.api.rolls.register", roll_number="R1")
            with as_system() as actor:
                self.assertEqual((actor, frappe.session.user), (user, "Administrator"))
            self.assertEqual(frappe.session.user, user)
            self.assertEqual(frappe.local.session.sid, "real-session-id")
            self.assertEqual(frappe.local.session.data.csrf_token, "tok")
            self.assertEqual(frappe.local.form_dict.roll_number, "R1")
            self.assertIn("Godown Operator", frappe.get_roles())

    def test_restored_even_when_the_write_fails(self):
        user = make_user("Godown Operator")
        with as_user(user):
            frappe.local.session.sid = "sid-2"
            with self.assertRaises(ZeroDivisionError), as_system():
                1 / 0
            self.assertEqual((frappe.session.user, frappe.local.session.sid), (user, "sid-2"))

    def test_the_session_object_frappe_holds_never_stays_administrator(self):
        # frappe.local.session_obj.data is this same object, and is what Frappe saves to the
        # session cache at the end of a request. Restoring a copy would leave it Administrator.
        user = make_user("Godown Operator")
        with as_user(user):
            held = frappe.local.session
            held.sid = "sid-3"
            original_data = frappe._dict(csrf_token="tok")
            held.data = original_data
            with as_system():
                pass
            self.assertIs(frappe.local.session, held)
            self.assertEqual((held.user, held.sid), (user, "sid-3"))
            self.assertIs(held.data, original_data)
            with self.assertRaises(ZeroDivisionError), as_system():
                1 / 0
            self.assertIs(frappe.local.session, held)
            self.assertEqual((held.user, held.sid), (user, "sid-3"))

    def test_permissions_are_the_real_users_again_afterwards(self):
        user = make_user("Godown Operator")
        with as_user(user):
            self.assertFalse(frappe.has_permission("Stock Entry", "create"))
            with as_system():
                self.assertTrue(frappe.has_permission("Stock Entry", "create"))
            self.assertFalse(frappe.has_permission("Stock Entry", "create"))
            self.assertEqual(frappe.get_user().name, user)
