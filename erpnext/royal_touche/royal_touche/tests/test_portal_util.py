import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.portal import GODOWN_WRITE, page_of, page_window, require_roles
from royal_touche.tests.factories import as_user, make_user


class TestPortalUtil(IntegrationTestCase):
    def test_page_shape_matches_the_old_server(self):
        self.assertEqual(page_of(["a", "b"], total=12, page=2, page_size=5),
                         {"items": ["a", "b"], "total": 12, "page": 2, "pageSize": 5, "totalPages": 3})
        self.assertEqual(page_of([], total=0, page=1, page_size=20)["totalPages"], 1)  # Node: "Page 1 of 1", never "of 0"

    def test_page_window_clamps(self):
        self.assertEqual(page_window(None, None), (1, 20, 0))
        self.assertEqual(page_window("3", "10"), (3, 10, 20))
        self.assertEqual(page_window(0, 1000), (1, 100, 0))

    def test_roles_follow_the_old_server(self):
        operator, supervisor, admin = (make_user(r) for r in ("Godown Operator", "Godown Supervisor", "RT Admin"))
        superadmin = make_user("RT Super Admin")
        with as_user(operator), self.assertRaises(frappe.PermissionError):
            require_roles("admin", "godown_supervisor")
        for user in (supervisor, admin, superadmin):  # super_admin always passes, as requireRole did
            with as_user(user):
                require_roles("admin", "godown_supervisor")
        with as_user(operator):
            require_roles(*GODOWN_WRITE)
        with as_user(make_user("Accounts User")), self.assertRaises(frappe.PermissionError):
            require_roles(*GODOWN_WRITE)

    def test_refusal_message_reaches_the_client(self):
        # With developer mode off a bare exception reaches the browser with no text; only the
        # message log (_server_messages) carries it, and that is what the portal reads.
        frappe.local.message_log = []
        with as_user(make_user("Godown Operator")), self.assertRaises(frappe.PermissionError):
            require_roles("admin")
        self.assertIn("You do not have permission to perform this action",
                      " ".join(str(m) for m in frappe.local.message_log))
