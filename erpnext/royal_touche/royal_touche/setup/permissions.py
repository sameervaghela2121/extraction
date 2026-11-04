"""Who may read and change what — today's Node rules (backend/src/middleware/rbac.middleware.ts
and the routes), plus the new rule that prices are hidden from godown roles (spec §7).

- Godown work (masters, rolls, movements, sync): every RT role.
- Buyers: read for all; added and edited by supervisors and admins (in the portal).
- Prices (permlevel 1): RT Admin and RT Super Admin only.
- Stock documents (Stock Entry, Purchase Receipt, Delivery Note, Stock Reconciliation): no
  godown role may create them; only our business actions do, with ignore_permissions."""

import frappe
from frappe.custom.doctype.property_setter.property_setter import make_property_setter
from frappe.permissions import add_permission, update_permission_property

SUPER, ADMIN, SUPERVISOR, OPERATOR = "RT Super Admin", "RT Admin", "Godown Supervisor", "Godown Operator"
ALL_RT = (SUPER, ADMIN, SUPERVISOR, OPERATOR)
ADMINS = (SUPER, ADMIN)

# doctype → {role: rights at permlevel 0}
MATRIX = {
    "Item": {r: ("read", "write", "create") for r in ALL_RT},
    "Supplier": {r: ("read", "write", "create") for r in ALL_RT},
    "Warehouse": {r: ("read", "write", "create") for r in ALL_RT},
    "RT Remark": {r: ("read", "write", "create") for r in ALL_RT},
    "Roll Lot": {r: ("read", "write", "create") for r in ALL_RT},
    # No delete: a run's numbers stay spent. It is retired with its `deleted` flag, or
    # next_number would hand the same labels out again (two rolls, one barcode).
    "Barcode Batch": {r: ("read", "write", "create") for r in ALL_RT},
    "Batch": {r: ("read",) for r in ALL_RT},
    "Roll Movement": {r: ("read",) for r in ALL_RT},
    "Customer": {OPERATOR: ("read",), SUPERVISOR: ("read", "write", "create"),
                 ADMIN: ("read", "write", "create"), SUPER: ("read", "write", "create")},
    "Sync Log": {r: ("read",) for r in ADMINS},
    "Stock Entry": {r: ("read",) for r in ADMINS},
    "Purchase Receipt": {r: ("read",) for r in ADMINS},
    "Delivery Note": {r: ("read",) for r in ADMINS},
}
# doctype → {role: rights at permlevel 1}
PRICE_READERS = ADMINS + ("System Manager", "Item Manager", "Stock Manager")
PRICE_LEVEL = {
    "Roll Movement": {r: ("read", "write") for r in ADMINS},
    "Item": {r: ("read", "write") for r in PRICE_READERS},
}
# ERPNext's own price fields on Item, moved to permlevel 1 so godown roles can't see or set them.
ITEM_PRICE_FIELDS = ("valuation_rate", "last_purchase_rate", "standard_rate")
ALL_RIGHTS = ("read", "write", "create", "delete")


def ensure_permissions():
    for field in ITEM_PRICE_FIELDS:
        if not frappe.db.exists("Property Setter", {"doc_type": "Item", "field_name": field, "property": "permlevel"}):
            make_property_setter("Item", field, "permlevel", 1, "Int")
    for levels, permlevel in ((MATRIX, 0), (PRICE_LEVEL, 1)):
        for doctype, roles in levels.items():
            for role, rights in roles.items():
                add_permission(doctype, role, permlevel=permlevel, ptype=rights[0])
                # Exactly the rights listed, so one removed here is removed on existing sites too.
                for right in ALL_RIGHTS:
                    update_permission_property(doctype, role, permlevel, right, int(right in rights), validate=False)
    frappe.clear_cache(doctype="Item")
