"""Portal invite / reset links used to be ERPNext reset keys (User.reset_password_key), which
ERPNext's own guest update_password accepts with no expiry. The portal now keeps its own key
(see api/portal_users.py); this retires the ones already sent, on RT accounts only. A person
holding one asks for a new link."""

import frappe

from royal_touche.setup.install import RT_ROLES


def execute():
    users = frappe.get_all("Has Role", filters={"parenttype": "User", "role": ("in", RT_ROLES)}, pluck="parent",
                           distinct=True)
    for user in users:
        if frappe.db.get_value("User", user, "reset_password_key"):
            frappe.db.set_value("User", user, "reset_password_key", None, update_modified=False)
