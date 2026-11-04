import frappe

from royal_touche import pull
from royal_touche.api._access import require_godown_role, without_prices


@frappe.whitelist(methods=["GET"])
def changes(kind: str, after: str | None = None, after_name: str | None = None, limit: int = 200) -> dict:
    require_godown_role()
    page = pull.changes(kind, after or None, after_name or None, limit)
    if kind == "movements":
        page["items"] = [without_prices(mv) for mv in page["items"]]
    return page
