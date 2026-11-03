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
