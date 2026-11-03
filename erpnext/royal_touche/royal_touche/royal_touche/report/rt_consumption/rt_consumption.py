from frappe.utils import getdate

from royal_touche import reports

FIGURES = [
    ("opening", "Opening (kg)"), ("received", "Received (kg)"), ("consumed", "Consumed (kg)"),
    ("returned_to_vendor", "Returned to vendor (kg)"), ("sold", "Sold (kg)"), ("adjusted", "Adjusted (kg)"),
    ("closing", "Closing (kg)"), ("out_at_close", "Out at close (kg)"),
]


def execute(filters=None):
    filters = filters or {}
    group = filters.get("group") or "material"
    summary = reports.consumption_summary(getdate(filters.get("from_date")), getdate(filters.get("to_date")), group)
    if group == "design":
        head = [("rt_code", "RT code", "Data", 100), ("delta_code", "Delta code", "Data", 100),
                ("material", "Material", "Data", 160), ("vendor", "Vendor", "Data", 200)]
    else:
        head = [("material_code", "Material code", "Data", 130), ("material", "Material", "Data", 180)]
    columns = [{"fieldname": f, "label": label, "fieldtype": t, "width": w} for f, label, t, w in head]
    columns += [{"fieldname": f, "label": label, "fieldtype": "Float", "precision": 3, "width": 130} for f, label in FIGURES]
    return columns, summary["rows"]
