import frappe


@frappe.whitelist(methods=["GET"])
def apk_url() -> dict:
    """Where the current Android build can be downloaded (site config key rt_apk_url)."""
    return {"url": frappe.conf.get("rt_apk_url")}
