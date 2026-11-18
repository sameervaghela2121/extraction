"""The admin portal's master screens (royal_touche.api.portal_masters) answer as the old server
did: backend/src/services/{vendors,locations,rawMaterials,remarks}.service.ts."""

import re

import frappe
from frappe.tests import IntegrationTestCase

from royal_touche.api import portal_masters as pm
from royal_touche.errors import RTConflict, RTDuplicate, RTNotFound, RTValidation
from royal_touche.tests.factories import as_user, make_user, unique

ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
VENDOR_KEYS = {"id", "vendor_code", "name", "papers", "contact", "address", "gst_number", "status", "createdAt", "updatedAt"}
PAGE_KEYS = {"items", "total", "page", "pageSize", "totalPages"}


def tag() -> str:
    """A prefix only this test's rows carry, so searches ignore the site's other data."""
    return unique("T").replace("-", "").upper()


class TestPortalMasters(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = make_user("RT Admin")
        cls.operator = make_user("Godown Operator")
        cls.outsider = make_user("Accounts User")

    def setUp(self):
        frappe.set_user(self.admin)

    def tearDown(self):
        frappe.set_user("Administrator")

    # ------------------------------------------------------------------ vendors

    def test_vendor_create_shape(self):
        t = tag()
        v = pm.vendors_create(body={
            "vendor_code": f" {t.lower()}-1 ", "name": f" {t} Paper Mills ", "gst_number": "27abcde1234f1z5",
            "address": "Pune", "papers": [{"royal_touche_code": "868", "delta_code": "d1", "is_common": True,
                                           "supplier_code_number": "55036-29", "found_in": "1mm"}],
        })
        self.assertEqual(set(v), VENDOR_KEYS)
        self.assertEqual((v["vendor_code"], v["name"], v["gst_number"], v["address"], v["status"]),
                         (f"{t}-1", f"{t} Paper Mills", "27ABCDE1234F1Z5", "Pune", "active"))
        self.assertEqual(v["papers"], [{"royal_touche_code": "868", "delta_code": "D1", "is_common": True,
                                        "supplier_code_number": "55036-29", "found_in": "1mm"}])
        self.assertEqual(v["contact"], {})
        self.assertRegex(v["createdAt"], ISO)
        self.assertRegex(v["updatedAt"], ISO)
        self.assertEqual(frappe.db.get_value("Supplier", v["id"], "rt_vendor_code"), f"{t}-1")
        self.assertEqual(pm.vendors_get(id=v["id"]), v)

    def test_vendor_validation_messages(self):
        with self.assertRaisesRegex(RTValidation, "^vendor_code: Vendor code is required$"):
            pm.vendors_create(body={"vendor_code": "  ", "name": "X"})
        with self.assertRaisesRegex(RTValidation, "^vendor_code: Required, name: Required$"):
            pm.vendors_create(body={})
        with self.assertRaisesRegex(RTValidation, re.escape(
                "papers.0.royal_touche_code: A paper needs at least a royal_touche_code or a delta_code")):
            pm.vendors_create(body={"vendor_code": tag(), "name": "X", "papers": [{"supplier_code_number": "S1"}]})
        v = pm.vendors_create(body={"vendor_code": tag(), "name": tag()})
        with self.assertRaisesRegex(RTValidation, "^Provide at least one field to update$"):
            pm.vendors_update(id=v["id"], body={})
        with self.assertRaisesRegex(RTValidation, "^Name is required$"):
            pm.vendors_update(id=v["id"], body={"name": " "})

    def test_vendor_code_taken(self):
        t = tag()
        first = pm.vendors_create(body={"vendor_code": t, "name": tag()})
        with self.assertRaises(RTDuplicate) as caught:
            pm.vendors_create(body={"vendor_code": t.lower(), "name": tag()})
        self.assertEqual(str(caught.exception), "A vendor with this code already exists")
        other = pm.vendors_create(body={"vendor_code": tag(), "name": tag()})
        with self.assertRaisesRegex(RTDuplicate, "^A vendor with this code already exists$"):
            pm.vendors_update(id=other["id"], body={"vendor_code": t})
        # Its own code is not a clash.
        self.assertEqual(pm.vendors_update(id=first["id"], body={"vendor_code": t, "name": "Renamed"})["name"], "Renamed")

    def test_two_vendors_may_share_a_name(self):
        name = tag()
        a = pm.vendors_create(body={"vendor_code": tag(), "name": name})
        b = pm.vendors_create(body={"vendor_code": tag(), "name": name})
        self.assertNotEqual(a["id"], b["id"])
        self.assertEqual(b["name"], name)

    def test_vendor_rename_keeps_its_id(self):
        v = pm.vendors_create(body={"vendor_code": tag(), "name": tag()})
        renamed = pm.vendors_update(id=v["id"], body={"name": "New name"})
        self.assertEqual((renamed["id"], renamed["name"]), (v["id"], "New name"))

    def test_vendor_papers_are_replaced_as_a_set(self):
        v = pm.vendors_create(body={"vendor_code": tag(), "name": tag(),
                                    "papers": [{"royal_touche_code": "1"}, {"royal_touche_code": "2"}]})
        out = pm.vendors_update(id=v["id"], body={"papers": [{"royal_touche_code": "2"}, {"delta_code": "d3"}]})
        self.assertEqual(out["papers"], [{"royal_touche_code": "2", "is_common": False},
                                         {"delta_code": "D3", "is_common": False}])
        # A PATCH without papers leaves them alone.
        self.assertEqual(len(pm.vendors_update(id=v["id"], body={"address": "x"})["papers"]), 2)

    def test_vendor_search_rows_have_no_papers_and_page(self):
        t = tag()
        for i in (3, 1, 2, 10):
            pm.vendors_create(body={"vendor_code": f"{t}-{i}", "name": f"{t} vendor {i}", "papers": [{"royal_touche_code": "9"}]})
        res = pm.vendors_search(page=1, pageSize=3, q=t.lower(), sort="vendor_code")
        self.assertEqual(set(res), PAGE_KEYS)
        self.assertEqual((res["total"], res["page"], res["pageSize"], res["totalPages"]), (4, 1, 3, 2))
        self.assertEqual([r["vendor_code"] for r in res["items"]], [f"{t}-1", f"{t}-2", f"{t}-3"])
        self.assertNotIn("papers", res["items"][0])
        self.assertEqual(set(res["items"][0]), VENDOR_KEYS - {"papers"})
        page2 = pm.vendors_search(page=2, pageSize=3, q=t, sort="vendor_code")
        self.assertEqual([r["vendor_code"] for r in page2["items"]], [f"{t}-10"])
        desc = pm.vendors_search(page=1, pageSize=25, q=t, sort="vendor_code", order="desc")
        self.assertEqual([r["vendor_code"] for r in desc["items"]], [f"{t}-10", f"{t}-3", f"{t}-2", f"{t}-1"])
        empty = pm.vendors_search(page=1, pageSize=25, q=tag())
        self.assertEqual((empty["items"], empty["total"], empty["totalPages"]), ([], 0, 1))
        with self.assertRaisesRegex(RTValidation, "^sort: Invalid enum value"):
            pm.vendors_search(page=1, pageSize=25, sort="gst_number")

    def test_vendor_search_matches_gst(self):
        t = tag()
        pm.vendors_create(body={"vendor_code": tag(), "name": tag(), "gst_number": f"GST{t}"})
        self.assertEqual(pm.vendors_search(page=1, pageSize=25, q=t)["total"], 1)

    def test_vendor_soft_delete(self):
        t = tag()
        v = pm.vendors_create(body={"vendor_code": t, "name": f"{t} soft"})
        self.assertEqual(pm.vendors_remove(id=v["id"]), {"id": v["id"], "status": "inactive"})
        self.assertEqual(frappe.db.get_value("Supplier", v["id"], "disabled"), 1)
        self.assertEqual(pm.vendors_search(page=1, pageSize=25, q=t, status="inactive")["total"], 1)
        self.assertEqual(pm.vendors_search(page=1, pageSize=25, q=t, status="active")["total"], 0)
        self.assertEqual(pm.vendors_search(page=1, pageSize=25, q=t)["total"], 1)
        self.assertEqual([x["status"] for x in pm.vendors_list(q=t)], ["inactive"])
        self.assertEqual(pm.vendors_update(id=v["id"], body={"status": "active"})["status"], "active")

    def test_vendor_list_is_whole_with_papers(self):
        t = tag()
        pm.vendors_create(body={"vendor_code": f"{t}-B", "name": f"{t} b", "papers": [{"royal_touche_code": "5"}]})
        pm.vendors_create(body={"vendor_code": f"{t}-A", "name": f"{t} a"})
        rows = pm.vendors_list(q=t)
        self.assertEqual([r["name"] for r in rows], [f"{t} a", f"{t} b"])
        self.assertEqual(set(rows[0]), VENDOR_KEYS)
        self.assertEqual(rows[1]["papers"], [{"royal_touche_code": "5", "is_common": False}])

    def test_vendor_not_found(self):
        with self.assertRaisesRegex(RTNotFound, "^Vendor not found$"):
            pm.vendors_get(id="no-such-vendor")

    def test_search_papers_one_row_per_paper(self):
        t = tag()
        a = pm.vendors_create(body={"vendor_code": tag(), "name": f"{t} A", "papers": [
            {"royal_touche_code": f"{t}2", "supplier_code_number": "s-a2"},
            {"royal_touche_code": f"{t}10", "delta_code": "d", "supplier_code_number": "s-a10"}]})
        b = pm.vendors_create(body={"vendor_code": tag(), "name": f"{t} B", "papers": [{"delta_code": f"{t}D"}]})
        res = pm.vendors_search_papers(page=1, pageSize=25, q=t)
        self.assertEqual(set(res), PAGE_KEYS)
        self.assertEqual(res["total"], 3)
        first = res["items"][0]
        self.assertEqual(first, {"vendor": {"id": a["id"], "name": f"{t} A", "vendor_code": a["vendor_code"]},
                                 "index": 0, "paper": {"royal_touche_code": f"{t}2", "is_common": False,
                                                       "supplier_code_number": "S-A2"}})
        self.assertEqual([(r["vendor"]["id"], r["index"]) for r in res["items"]], [(a["id"], 0), (a["id"], 1), (b["id"], 0)])
        desc = pm.vendors_search_papers(page=1, pageSize=25, q=t, sort="vendor", order="desc")
        self.assertEqual([(r["vendor"]["id"], r["index"]) for r in desc["items"]], [(b["id"], 0), (a["id"], 1), (a["id"], 0)])
        by_rt = pm.vendors_search_papers(page=1, pageSize=25, q=t, sort="royal_touche_code")
        # Missing first, then "…2" before "…10".
        self.assertEqual([r["paper"].get("royal_touche_code") for r in by_rt["items"]], [None, f"{t}2", f"{t}10"])
        self.assertEqual(pm.vendors_search_papers(page=1, pageSize=25, q="s-A10")["items"][0]["index"], 1)
        self.assertEqual(pm.vendors_search_papers(page=2, pageSize=2, q=t)["items"][0]["vendor"]["id"], b["id"])

    # ------------------------------------------------------------------ locations

    def test_location_create_shape_and_next_sort_order(self):
        t = tag()
        top = max([r["sort_order"] or 0 for r in pm.locations_list()] or [0])
        loc = pm.locations_create(body={"location_code": f" {t.lower()} ", "name": f"{t} bay", "godown": "Godown A"})
        self.assertEqual(set(loc), {"id", "location_code", "name", "godown", "sort_order", "status", "createdAt", "updatedAt"})
        self.assertEqual((loc["location_code"], loc["name"], loc["godown"], loc["sort_order"], loc["status"]),
                         (t, f"{t} bay", "Godown A", top + 1, "active"))
        self.assertEqual(frappe.db.get_value("Warehouse", loc["id"], "company"), "Royale Touche")
        with self.assertRaisesRegex(RTDuplicate, "^A location with this code already exists$"):
            pm.locations_create(body={"location_code": t, "name": "other"})
        self.assertEqual(pm.locations_create(body={"location_code": tag(), "name": "x", "sort_order": 7})["sort_order"], 7)

    def test_location_list_leaves_out_non_rt_warehouses(self):
        names = {r["id"] for r in pm.locations_list()}
        self.assertNotIn("Unassigned - RT", names)
        self.assertNotIn("All Warehouses - RT", names)
        self.assertNotIn("Stores - RT", names)
        with self.assertRaisesRegex(RTNotFound, "^Location not found$"):
            pm.locations_get(id="Unassigned - RT")

    def test_two_locations_may_share_a_name(self):
        name = tag()
        a = pm.locations_create(body={"location_code": tag(), "name": name})
        b = pm.locations_create(body={"location_code": tag(), "name": name})
        self.assertNotEqual(a["id"], b["id"])
        self.assertEqual(b["name"], name)

    def test_location_search_sorts_codes_naturally(self):
        t = tag()
        for code in ("A-10", "a-2", "A-1"):
            pm.locations_create(body={"location_code": f"{t}{code}", "name": code})
        res = pm.locations_search(page=1, pageSize=25, q=t, sort="location_code")
        self.assertEqual([r["location_code"] for r in res["items"]], [f"{t}A-1", f"{t}A-2", f"{t}A-10"])
        by_name = pm.locations_search(page=1, pageSize=25, q=t, sort="name", order="desc")
        self.assertEqual([r["name"] for r in by_name["items"]], ["A-10", "a-2", "A-1"])
        # Default: sort_order, the order they were added.
        self.assertEqual([r["name"] for r in pm.locations_search(page=1, pageSize=25, q=t)["items"]], ["A-10", "a-2", "A-1"])

    def test_location_soft_delete(self):
        t = tag()
        loc = pm.locations_create(body={"location_code": t, "name": t})
        self.assertEqual(pm.locations_remove(id=loc["id"]), {"id": loc["id"], "status": "inactive"})
        self.assertEqual(frappe.db.get_value("Warehouse", loc["id"], "disabled"), 1)
        self.assertEqual(pm.locations_search(page=1, pageSize=25, q=t, status="inactive")["total"], 1)
        self.assertEqual(pm.locations_get(id=loc["id"])["status"], "inactive")

    def test_location_reorder_one_page(self):
        for _ in range(3):
            pm.locations_create(body={"location_code": tag(), "name": tag()})
        page = pm.locations_search(page=2, pageSize=3)["items"]
        ids = [r["id"] for r in reversed(page)]
        out = pm.locations_reorder(ids=ids, offset=3)
        self.assertEqual([r["id"] for r in out][3:6], ids)
        after = pm.locations_search(page=2, pageSize=3)["items"]
        self.assertEqual([r["id"] for r in after], ids)
        self.assertEqual([r["sort_order"] for r in after], [4, 5, 6])
        first = pm.locations_search(page=1, pageSize=3)["items"]
        self.assertEqual([r["sort_order"] for r in first], [1, 2, 3])
        with self.assertRaisesRegex(RTConflict, "^The location list changed since it was loaded — reload and try again$"):
            pm.locations_reorder(ids=ids, offset=0)

    def test_location_reorder_validation(self):
        a = pm.locations_create(body={"location_code": tag(), "name": tag()})
        b = pm.locations_create(body={"location_code": tag(), "name": tag()})
        with self.assertRaisesRegex(RTValidation, "^ids: Provide at least one location id$"):
            pm.locations_reorder(ids=[])
        with self.assertRaisesRegex(RTValidation, "^The same location appears twice in the new order$"):
            pm.locations_reorder(ids=[a["id"], a["id"]])
        with self.assertRaisesRegex(RTValidation, "^One or more location ids were not found$"):
            pm.locations_reorder(ids=[a["id"], "nope"])
        # Without an offset the ids are the whole order: numbered 1..N.
        pm.locations_reorder(ids=[b["id"], a["id"]])
        self.assertEqual((pm.locations_get(id=b["id"])["sort_order"], pm.locations_get(id=a["id"])["sort_order"]), (1, 2))

    # ------------------------------------------------------------------ material types

    def test_material_create_shape(self):
        t = tag()
        m = pm.materials_create(body={"material_code": f"{t.lower()}-x", "name": f"{t} tissue"})
        self.assertEqual(set(m), {"id", "material_code", "name", "category", "gsm", "width_mm", "unit", "reorder_level",
                                  "sort_order", "status", "createdAt", "updatedAt"})
        self.assertEqual((m["material_code"], m["name"], m["unit"], m["status"]), (f"{t}-X", f"{t} tissue", "kg", "active"))
        item = frappe.get_doc("Item", m["id"])
        self.assertEqual((item.stock_uom, item.has_batch_no, item.is_stock_item), ("Kg", 1, 1))
        with self.assertRaisesRegex(RTDuplicate, "^A material with this code already exists$"):
            pm.materials_create(body={"material_code": f"{t}-x", "name": "again"})
        with self.assertRaisesRegex(RTValidation, "^material_code: Material code is required$"):
            pm.materials_create(body={"material_code": "", "name": "x"})

    def test_material_code_change_keeps_id_and_frees_nothing_else(self):
        m = pm.materials_create(body={"material_code": tag(), "name": tag()})
        new_code = tag()
        out = pm.materials_update(id=m["id"], body={"material_code": new_code, "name": "renamed"})
        self.assertEqual((out["id"], out["material_code"], out["name"]), (m["id"], new_code, "renamed"))
        # The old code is free again, even though the Item keeps its first name.
        again = pm.materials_create(body={"material_code": m["material_code"], "name": "reuse"})
        self.assertNotEqual(again["id"], m["id"])

    def test_material_list_unnumbered_last(self):
        t = tag()
        a = pm.materials_create(body={"material_code": f"{t}A", "name": f"{t} b"})
        b = pm.materials_create(body={"material_code": f"{t}B", "name": f"{t} a"})
        frappe.db.set_value("Item", a["id"], "rt_sort_order", 0)
        self.assertEqual([r["id"] for r in pm.materials_list(q=t)], [b["id"], a["id"]])

    def test_material_soft_delete_and_reorder(self):
        t = tag()
        ms = [pm.materials_create(body={"material_code": f"{t}{i}", "name": f"{t}{i}"}) for i in range(3)]
        self.assertEqual(pm.materials_remove(id=ms[0]["id"]), {"id": ms[0]["id"], "status": "inactive"})
        self.assertEqual(frappe.db.get_value("Item", ms[0]["id"], "disabled"), 1)
        self.assertEqual(pm.materials_search(page=1, pageSize=25, q=t, status="inactive")["total"], 1)
        with self.assertRaisesRegex(RTNotFound, "^Material not found$"):
            pm.materials_get(id="no-such-item")

    # ------------------------------------------------------------------ remarks

    def test_remark_crud(self):
        t = tag()
        r = pm.remarks_create(body={"remark_code": f"{t.lower()}", "label": " Torn edge "})
        self.assertEqual(set(r), {"id", "remark_code", "label", "sort_order", "status", "createdAt", "updatedAt"})
        self.assertEqual((r["remark_code"], r["label"], r["status"]), (t, "Torn edge", "active"))
        with self.assertRaisesRegex(RTDuplicate, "^A remark with this code already exists$"):
            pm.remarks_create(body={"remark_code": t, "label": "x"})
        with self.assertRaisesRegex(RTValidation, "^Label is required$"):
            pm.remarks_create(body={"remark_code": tag(), "label": ""})
        self.assertEqual(pm.remarks_update(id=r["id"], body={"label": "Wet"})["label"], "Wet")
        self.assertEqual(pm.remarks_remove(id=r["id"]), {"id": r["id"], "status": "inactive"})
        self.assertEqual(frappe.db.get_value("RT Remark", r["id"], "disabled"), 1)
        self.assertEqual(pm.remarks_search(page=1, pageSize=25, q=t, status="inactive")["items"][0]["id"], r["id"])
        with self.assertRaisesRegex(RTNotFound, "^Remark not found$"):
            pm.remarks_get(id="nope")
        with self.assertRaisesRegex(RTValidation, "^status: Invalid enum value"):
            pm.remarks_update(id=r["id"], body={"status": "gone"})

    def test_remark_reorder_returns_whole_list(self):
        rs = [pm.remarks_create(body={"remark_code": tag(), "label": tag()}) for _ in range(2)]
        out = pm.remarks_reorder(ids=[rs[1]["id"], rs[0]["id"]])
        # Without an offset only the given rows are renumbered (1, 2); the reply is the whole
        # list in the picker's order, as remarks.service list() gives it.
        ids = [r["id"] for r in out]
        self.assertEqual(len(ids), len(pm.remarks_list()))
        self.assertLess(ids.index(rs[1]["id"]), ids.index(rs[0]["id"]))
        self.assertEqual((pm.remarks_get(id=rs[1]["id"])["sort_order"], pm.remarks_get(id=rs[0]["id"])["sort_order"]), (1, 2))

    # ------------------------------------------------------------------ roles

    def test_godown_operator_may_maintain_masters(self):
        with as_user(self.operator):
            r = pm.remarks_create(body={"remark_code": tag(), "label": "x"})
            self.assertEqual(pm.remarks_get(id=r["id"])["id"], r["id"])

    def test_non_rt_user_is_refused(self):
        r = pm.remarks_create(body={"remark_code": tag(), "label": "x"})
        with as_user(self.outsider):
            for call in (lambda: pm.vendors_list(), lambda: pm.remarks_get(id=r["id"]),
                         lambda: pm.locations_search(page=1, pageSize=25),
                         lambda: pm.vendors_search_papers(page=1, pageSize=25),
                         lambda: pm.materials_create(body={"material_code": tag(), "name": "x"}),
                         lambda: pm.remarks_update(id=r["id"], body={"label": "y"}),
                         lambda: pm.remarks_remove(id=r["id"]),
                         lambda: pm.remarks_reorder(ids=[r["id"]])):
                with self.assertRaises(frappe.PermissionError):
                    call()
