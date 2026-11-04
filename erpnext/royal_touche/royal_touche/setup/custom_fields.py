"""Custom fields this app adds to ERPNext doctypes. Applied by ensure_setup()."""

from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

CUSTOM_FIELDS = {
    "Supplier": [
        {"fieldname": "rt_vendor_code", "label": "Vendor code", "fieldtype": "Data", "unique": 1,
         "insert_after": "supplier_name", "in_standard_filter": 1},
        {"fieldname": "rt_papers", "label": "Papers", "fieldtype": "Table", "options": "Vendor Paper",
         "insert_after": "rt_vendor_code"},
        # A vendor added on a tablet while offline: its retry must find this one again.
        {"fieldname": "rt_client_id", "label": "Client id", "fieldtype": "Data", "unique": 1, "read_only": 1,
         "insert_after": "rt_papers"},
        # The portal's free-text vendor address. ERPNext's own addresses are separate Address
        # records with required city/country, which a one-line address can't fill.
        {"fieldname": "rt_address", "label": "Address", "fieldtype": "Small Text", "insert_after": "rt_client_id"},
    ],
    "Item": [
        {"fieldname": "rt_material_code", "label": "Material code", "fieldtype": "Data", "unique": 1,
         "insert_after": "item_name", "in_standard_filter": 1},
        {"fieldname": "rt_sort_order", "label": "Sort order", "fieldtype": "Int", "insert_after": "rt_material_code"},
    ],
    # One Batch per roll (spec §6). The cached rt_status / rt_remaining_weight / rt_location
    # let the tablet's roll pull read one table; checks.ledger_mismatches() proves them.
    "Batch": [
        {"fieldname": "rt_section", "label": "Roll", "fieldtype": "Section Break", "insert_after": "batch_qty"},
        {"fieldname": "rt_roll_number", "label": "Roll number", "fieldtype": "Data", "insert_after": "rt_section",
         "in_standard_filter": 1, "in_list_view": 1},
        {"fieldname": "rt_barcode", "label": "Barcode", "fieldtype": "Data", "insert_after": "rt_roll_number",
         "in_standard_filter": 1},
        # = roll number / barcode while the roll is live, NULL once deleted: a unique index that
        # only covers live rolls, so a deleted roll's number can be used again.
        {"fieldname": "rt_roll_key", "label": "Roll key", "fieldtype": "Data", "unique": 1, "hidden": 1,
         "insert_after": "rt_barcode"},
        {"fieldname": "rt_barcode_key", "label": "Barcode key", "fieldtype": "Data", "unique": 1, "hidden": 1,
         "insert_after": "rt_roll_key"},
        {"fieldname": "rt_status", "label": "Roll status", "fieldtype": "Select", "read_only": 1, "in_list_view": 1,
         "options": "IN_STOCK\nISSUED\nCONSUMED\nRETURNED_TO_VENDOR\nSOLD", "insert_after": "rt_barcode_key",
         "in_standard_filter": 1},
        {"fieldname": "rt_original_weight", "label": "Original weight (kg)", "fieldtype": "Float", "read_only": 1,
         "insert_after": "rt_status"},
        {"fieldname": "rt_remaining_weight", "label": "Remaining weight (kg)", "fieldtype": "Float", "read_only": 1,
         "insert_after": "rt_original_weight"},
        {"fieldname": "rt_location", "label": "Location", "fieldtype": "Link", "options": "Warehouse", "read_only": 1,
         "insert_after": "rt_remaining_weight"},
        {"fieldname": "rt_col", "fieldtype": "Column Break", "insert_after": "rt_location"},
        {"fieldname": "rt_vendor", "label": "Vendor", "fieldtype": "Link", "options": "Supplier", "insert_after": "rt_col"},
        {"fieldname": "rt_lot", "label": "Lot", "fieldtype": "Link", "options": "Roll Lot", "insert_after": "rt_vendor"},
        {"fieldname": "rt_paper_code", "label": "Paper code", "fieldtype": "Data", "insert_after": "rt_lot"},
        {"fieldname": "rt_rt_code", "label": "RT code", "fieldtype": "Data", "insert_after": "rt_paper_code"},
        {"fieldname": "rt_delta_code", "label": "Delta code", "fieldtype": "Data", "insert_after": "rt_rt_code"},
        {"fieldname": "rt_gsm", "label": "GSM", "fieldtype": "Float", "insert_after": "rt_delta_code"},
        {"fieldname": "rt_width", "label": "Width", "fieldtype": "Float", "insert_after": "rt_gsm"},
        {"fieldname": "rt_remark_codes", "label": "Remarks", "fieldtype": "Table MultiSelect", "options": "RT Remark Link",
         "insert_after": "rt_width"},
        {"fieldname": "rt_tag_photo", "label": "Tag photo", "fieldtype": "Attach Image", "insert_after": "rt_remark_codes"},
        {"fieldname": "rt_barcode_photo", "label": "Barcode photo", "fieldtype": "Attach Image", "insert_after": "rt_tag_photo"},
        {"fieldname": "rt_side1_photo", "label": "Side 1 photo", "fieldtype": "Attach Image", "insert_after": "rt_barcode_photo"},
        {"fieldname": "rt_side2_photo", "label": "Side 2 photo", "fieldtype": "Attach Image", "insert_after": "rt_side1_photo"},
        {"fieldname": "rt_client_id", "label": "Client id", "fieldtype": "Data", "unique": 1, "read_only": 1,
         "insert_after": "rt_barcode_photo"},
        {"fieldname": "rt_deleted", "label": "Deleted", "fieldtype": "Check", "read_only": 1, "insert_after": "rt_client_id"},
        {"fieldname": "rt_purchase_receipt", "label": "Purchase receipt", "fieldtype": "Link",
         "options": "Purchase Receipt", "read_only": 1, "insert_after": "rt_deleted"},
        # When this roll's newest stock document is posted: see stock_docs.ledger_time().
        {"fieldname": "rt_last_posted", "label": "Last posted", "fieldtype": "Datetime", "read_only": 1,
         "insert_after": "rt_purchase_receipt"},
    ],
    # The portal's emailed invite / reset link (api/portal_users.py). Kept apart from ERPNext's
    # own reset_password_key: ERPNext's guest update_password takes that one with no expiry and
    # none of the portal's checks. Only the key's sha256 is stored.
    "User": [
        {"fieldname": "rt_link_key_hash", "label": "Portal link key", "fieldtype": "Data", "hidden": 1, "read_only": 1,
         "no_copy": 1, "search_index": 1, "insert_after": "last_reset_password_key_generated_on"},
        {"fieldname": "rt_link_purpose", "label": "Portal link purpose", "fieldtype": "Select", "options": "\ninvite\nreset",
         "hidden": 1, "read_only": 1, "no_copy": 1, "insert_after": "rt_link_key_hash"},
        {"fieldname": "rt_link_expires", "label": "Portal link expires", "fieldtype": "Datetime", "hidden": 1,
         "read_only": 1, "no_copy": 1, "insert_after": "rt_link_purpose"},
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
