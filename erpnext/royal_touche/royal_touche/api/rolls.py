import frappe

from royal_touche import rolls
from royal_touche.api._access import require_godown_role


@frappe.whitelist(methods=["POST"])
def register(**data) -> dict:
    require_godown_role()
    data.pop("cmd", None)
    return rolls.register_roll(data)


@frappe.whitelist(methods=["POST", "PATCH"])
def update(name: str, **changes) -> dict:
    require_godown_role()
    changes.pop("cmd", None)
    return rolls.update_roll(name, changes)


@frappe.whitelist(methods=["POST", "PUT"])
def set_remark_codes(name: str, codes: list | str) -> dict:
    require_godown_role()
    return rolls.set_remark_codes(name, frappe.parse_json(codes) if isinstance(codes, str) else codes)


@frappe.whitelist(methods=["POST", "DELETE"])
def delete(name: str) -> dict:
    require_godown_role()
    return rolls.delete_roll(name)


@frappe.whitelist(methods=["GET"])
def find(code: str) -> dict:
    require_godown_role()
    return rolls.roll_dict(rolls.find_roll(code))
