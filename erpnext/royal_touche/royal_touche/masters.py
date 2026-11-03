"""Rules for master data: codes are trimmed and upper-case everywhere (Global Constraints)."""


def normalise_code(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().upper()
    return value or None


def supplier_validate(doc, method=None):
    doc.rt_vendor_code = normalise_code(doc.rt_vendor_code)
    for paper in doc.get("rt_papers") or []:
        paper.paper_code = normalise_code(paper.paper_code)
        paper.rt_code = normalise_code(paper.rt_code)
        paper.delta_code = normalise_code(paper.delta_code)


def item_before_validate(doc, method=None):
    # A raw material is weighed in kg and tracked roll by roll; each roll's batch is made by
    # roll registration, never automatically.
    doc.rt_material_code = normalise_code(doc.rt_material_code)
    if doc.rt_material_code:
        doc.stock_uom = "Kg"
        doc.is_stock_item = 1
        doc.has_batch_no = 1
        doc.create_new_batch = 0


def warehouse_validate(doc, method=None):
    doc.rt_location_code = normalise_code(doc.rt_location_code)


def create_vendor(data: dict) -> dict:
    """A vendor added on the tablet (sync item "vendor"); a retry returns the first one."""
    from royal_touche import replay

    existing = replay.find("Supplier", "rt_client_id", data.get("client_id"))
    if existing:
        return vendor_dict(existing)
    return replay.guarded("Supplier", "rt_client_id", data.get("client_id"), lambda: _create_vendor(data), vendor_dict)


def _create_vendor(data: dict) -> dict:
    import frappe

    group = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups"
    return vendor_dict(frappe.get_doc({
        "doctype": "Supplier",
        "supplier_name": (data.get("name") or "").strip() or data.get("vendor_code"),
        "supplier_group": group,
        "rt_vendor_code": data.get("vendor_code"),
        "rt_papers": data.get("papers") or [],
        "rt_client_id": data.get("client_id") or None,
    }).insert(ignore_permissions=True).name)


def add_papers(vendor: str, papers: list[dict]) -> dict:
    """Add supplier codes to a vendor (sync item "supplier_code"). A paper the vendor already
    has is left alone, so a retried item changes nothing."""
    import frappe

    from royal_touche.errors import RTValidation

    if not papers:
        raise RTValidation("Send at least one supplier code")
    doc = frappe.get_doc("Supplier", vendor)
    have = {(p.paper_code, p.rt_code, p.delta_code) for p in doc.rt_papers}
    for p in papers:
        key = (normalise_code(p.get("paper_code")), normalise_code(p.get("rt_code")), normalise_code(p.get("delta_code")))
        if key not in have:
            doc.append("rt_papers", {"paper_code": key[0], "rt_code": key[1], "delta_code": key[2],
                                     "is_common": p.get("is_common") or 0, "found_in": p.get("found_in")})
            have.add(key)
    doc.flags.ignore_permissions = True
    doc.save()
    return vendor_dict(doc.name)


def vendor_dict(name: str) -> dict:
    import frappe

    doc = frappe.get_doc("Supplier", name)
    return {"name": doc.name, "vendor_code": doc.rt_vendor_code, "supplier_name": doc.supplier_name,
            "disabled": doc.disabled, "client_id": doc.rt_client_id, "modified": str(doc.modified),
            "papers": [{"paper_code": p.paper_code, "rt_code": p.rt_code, "delta_code": p.delta_code,
                        "is_common": p.is_common, "found_in": p.found_in} for p in doc.rt_papers]}
