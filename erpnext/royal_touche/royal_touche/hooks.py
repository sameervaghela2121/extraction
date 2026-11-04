app_name = "royal_touche"
app_title = "Royal Touche"
app_publisher = "Third Rock Techkno"
app_description = "Royale Touche roll inventory on ERPNext"
app_email = "devs@thirdrocktechkno.com"
app_license = "unlicense"

required_apps = ["erpnext"]

after_install = "royal_touche.setup.install.after_install"
after_migrate = "royal_touche.setup.install.ensure_setup"

doc_events = {
    "Supplier": {"validate": "royal_touche.masters.supplier_validate"},
    "Item": {"before_validate": "royal_touche.masters.item_before_validate"},
    "Warehouse": {"validate": "royal_touche.masters.warehouse_validate"},
}

# ERPNext's whitelisted rate lookups check no permissions; see api/guards.py.
override_whitelisted_methods = {
    "erpnext.stock.utils.get_incoming_rate": "royal_touche.api.guards.get_incoming_rate",
    "erpnext.stock.utils.get_stock_balance": "royal_touche.api.guards.get_stock_balance",
    "erpnext.stock.get_item_details.get_valuation_rate": "royal_touche.api.guards.get_valuation_rate",
}
