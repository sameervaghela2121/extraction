import frappe

from royal_touche import sync as sync_engine
from royal_touche.api._access import require_godown_role, without_prices


@frappe.whitelist(methods=["POST"])
def batch(items: list | str) -> dict:
    require_godown_role()
    items = frappe.parse_json(items) if isinstance(items, str) else items
    result = sync_engine.run_batch(items, ip=getattr(frappe.local, "request_ip", None))
    for r in result["results"]:
        if r["type"] == "movement" and r.get("data"):
            r["data"] = {**r["data"], "movement": without_prices(r["data"]["movement"])}
    return result
