import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from royal_touche.api import auth as auth_api
from royal_touche.api import movements as movements_api
from royal_touche.api import rolls as rolls_api
from royal_touche.errors import RTConflict
from royal_touche.rolls import register_roll
from royal_touche.tests.factories import as_user, base_roll, make_buyer, make_remark, make_user, standard_locations
from royal_touche.tests.test_movements import now_iso


class TestApiPermissions(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.operator = make_user("Godown Operator")
        cls.supervisor = make_user("Godown Supervisor")
        cls.admin = make_user("RT Admin")
        cls.outsider = make_user("Accounts User")

    def test_me_returns_the_rt_role(self):
        for user, role in ((self.operator, "godown_operator"), (self.supervisor, "godown_supervisor"), (self.admin, "admin")):
            with as_user(user):
                self.assertEqual(auth_api.me()["role"], role)

    def test_operator_cannot_post_a_stock_entry_directly(self):
        with as_user(self.operator), self.assertRaises(frappe.PermissionError):
            frappe.get_doc(
                {"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "company": "Royale Touche", "items": []}
            ).insert()

    def test_operator_registers_and_moves_through_the_api(self):
        loc = standard_locations()
        data = base_roll(location=loc["GODOWN-A-1"])
        with as_user(self.operator):
            roll = rolls_api.register(**data)
            res = movements_api.record(
                movement_type="OUT", roll=roll["name"], location=loc["RUNNING-1"],
                transaction_date=now_iso(), recorded_at=now_iso(),
            )
        self.assertEqual(res["roll"]["status"], "ISSUED")

    def test_operator_cannot_read_rate_per_roll(self):
        roll = register_roll(base_roll())["name"]
        movements_api.record(movement_type="SELL", roll=roll, buyer=make_buyer(), rate_per_roll=3000,
                             transaction_date=now_iso(), recorded_at=now_iso())
        with as_user(self.operator):
            rows = frappe.get_list("Roll Movement", filters={"roll": roll, "movement_type": "SELL"}, fields=["name", "rate_per_roll"])
        self.assertTrue(rows)
        self.assertIsNone(rows[0].get("rate_per_roll"))
        with as_user(self.admin):
            rows = frappe.get_list("Roll Movement", filters={"roll": roll, "movement_type": "SELL"}, fields=["name", "rate_per_roll"])
        self.assertEqual(rows[0]["rate_per_roll"], 3000)

    def test_godown_roles_delete_rolls_as_today_but_outsiders_cannot(self):
        # Node: DELETE /material-rolls/:id is requireGodownWrite (admin, store_manager,
        # godown_supervisor, godown_operator; super_admin always).
        roll = register_roll(base_roll())["name"]
        with as_user(self.outsider), self.assertRaises(frappe.PermissionError):
            rolls_api.delete(roll)
        with as_user(self.operator):
            self.assertTrue(rolls_api.delete(roll)["deleted"])

    def test_godown_roles_edit_masters_but_outsiders_cannot(self):
        remark = make_remark()
        with as_user(self.outsider), self.assertRaises(frappe.PermissionError):
            frappe.get_doc("RT Remark", remark).save()
        with as_user(self.operator):
            doc = frappe.get_doc("RT Remark", remark)
            doc.label = "Edited"
            doc.save()

    def test_only_supervisors_and_admins_add_buyers(self):
        with as_user(self.operator), self.assertRaises(frappe.PermissionError):
            make_buyer()
        with as_user(self.supervisor):
            self.assertTrue(make_buyer())

    def test_delta_read_includes_disabled_records_in_modified_order(self):
        since = add_to_date(now_datetime(), seconds=-1)
        live, gone = make_remark(), make_remark()
        frappe.db.set_value("RT Remark", gone, "disabled", 1, update_modified=True)
        with as_user(self.operator):
            rows = frappe.get_list(
                "RT Remark", filters={"modified": [">=", since]}, fields=["name", "disabled", "modified"],
                order_by="modified asc, name asc",
            )
        names = [r.name for r in rows]
        self.assertIn(live, names)
        self.assertIn(gone, names)
        keys = [(r.modified, r.name) for r in rows]
        self.assertEqual(keys, sorted(keys))

    def test_rt_errors_carry_status_and_reason(self):
        loc = standard_locations()
        roll = register_roll(base_roll(location=loc["GODOWN-A-1"]))["name"]
        with self.assertRaises(RTConflict) as caught:
            movements_api.record(movement_type="RETURN", roll=roll, returned_weight=1,
                                 transaction_date=now_iso(), recorded_at=now_iso())
        self.assertEqual((caught.exception.http_status_code, caught.exception.reason), (409, "conflict"))

    def test_stock_documents_record_who_acted(self):
        loc = standard_locations()
        data = base_roll(location=loc["GODOWN-A-1"])
        with as_user(self.operator):
            roll = rolls_api.register(**data)
        receipt = frappe.db.get_value("Batch", roll["name"], "rt_purchase_receipt")
        self.assertEqual(frappe.db.get_value("Purchase Receipt", receipt, "owner"), self.operator)
        self.assertEqual(frappe.session.user, "Administrator")

    def test_api_responses_hide_the_rate_from_godown_roles(self):
        roll = register_roll(base_roll())["name"]
        buyer = make_buyer()
        with as_user(self.operator):
            res = movements_api.record(movement_type="SELL", roll=roll, buyer=buyer, rate_per_roll=3000,
                                       transaction_date=now_iso(), recorded_at=now_iso())
        self.assertNotIn("rate_per_roll", res["movement"])
        roll2 = register_roll(base_roll())["name"]
        with as_user(self.admin):
            res = movements_api.record(movement_type="SELL", roll=roll2, buyer=buyer, rate_per_roll=2500,
                                       transaction_date=now_iso(), recorded_at=now_iso())
        self.assertEqual(res["movement"]["rate_per_roll"], 2500)
