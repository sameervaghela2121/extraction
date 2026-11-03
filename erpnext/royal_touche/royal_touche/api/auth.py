import frappe

from royal_touche.api._access import rt_role


@frappe.whitelist(methods=["GET"])
def me() -> dict:
    user = frappe.session.user
    return {"user": user, "full_name": frappe.utils.get_fullname(user), "role": rt_role(user)}
