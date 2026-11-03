"""Custom fields this app adds to ERPNext doctypes. Applied by ensure_setup()."""

from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

CUSTOM_FIELDS = {
    "Supplier": [
        {"fieldname": "rt_vendor_code", "label": "Vendor code", "fieldtype": "Data", "unique": 1,
         "insert_after": "supplier_name", "in_standard_filter": 1},
        {"fieldname": "rt_papers", "label": "Papers", "fieldtype": "Table", "options": "Vendor Paper",
         "insert_after": "rt_vendor_code"},
    ],
    "Item": [
        {"fieldname": "rt_material_code", "label": "Material code", "fieldtype": "Data", "unique": 1,
         "insert_after": "item_name", "in_standard_filter": 1},
        {"fieldname": "rt_sort_order", "label": "Sort order", "fieldtype": "Int", "insert_after": "rt_material_code"},
    ],
    "Warehouse": [
        {"fieldname": "rt_location_code", "label": "Location code", "fieldtype": "Data", "unique": 1,
         "insert_after": "warehouse_name", "in_standard_filter": 1},
        {"fieldname": "rt_godown", "label": "Godown", "fieldtype": "Data", "insert_after": "rt_location_code"},
        {"fieldname": "rt_sort_order", "label": "Sort order", "fieldtype": "Int", "insert_after": "rt_godown"},
    ],
}


def ensure_custom_fields():
    create_custom_fields(CUSTOM_FIELDS, ignore_validate=True, update=True)
