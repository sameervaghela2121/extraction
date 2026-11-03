import frappe

from royal_touche import movements
from royal_touche.api._access import require_godown_role, without_prices


@frappe.whitelist(methods=["POST"])
def record(**data) -> dict:
    require_godown_role()
    data.pop("cmd", None)
    result = movements.record_movement(data)
    return {**result, "movement": without_prices(result["movement"])}
