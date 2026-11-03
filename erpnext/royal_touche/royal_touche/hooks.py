app_name = "royal_touche"
app_title = "Royal Touche"
app_publisher = "Third Rock Techkno"
app_description = "Royale Touche roll inventory on ERPNext"
app_email = "devs@thirdrocktechkno.com"
app_license = "unlicense"

required_apps = ["erpnext"]

after_install = "royal_touche.setup.install.after_install"
after_migrate = "royal_touche.setup.install.ensure_setup"
