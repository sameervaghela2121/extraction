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
