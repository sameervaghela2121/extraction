"""Photo fields hold the path of a file uploaded to this server, nothing else. The app turns
these paths into links it opens with the user's login, so an arbitrary value (another endpoint,
another site) must never get in."""

import re

import frappe

from royal_touche.errors import RTValidation

OURS = ("Batch", "Roll Movement", "Roll Lot")

# Plain file names only, matching the app's check. Not a list of what's forbidden: URL libraries
# also read "\\" as "/" and %2e%2e as "..", so anything looser could climb out of files/.
FILE_PATH = re.compile(r"/(private/)?files/[^\W_][\w.() -]*")


IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
# Whose uploads can be someone else's photo: a queued photo may be sent after the user changed on
# the tablet. Never an administrator's: their private files aren't app photos.
APP_ROLES = {"RT Super Admin", "RT Admin", "Godown Supervisor", "Godown Operator"}
ADMINISTRATIVE_ROLE = "System Manager"


def is_file_path(path) -> bool:
    if not isinstance(path, str) or ".." in path or not path.lower().endswith(IMAGE_EXTENSIONS):
        return False
    return FILE_PATH.fullmatch(path) is not None


def _may_use(owner: str) -> bool:
    if owner == frappe.session.user:
        return True
    roles = set(frappe.get_roles(owner))
    return owner != "Administrator" and ADMINISTRATIVE_ROLE not in roles and bool(roles & APP_ROLES)


def _usable_rows(path: str) -> list:
    """Upload rows for this path that the app may use: uploaded by this user or another app user,
    and not belonging to anything else. ERPNext attaches an Attach field's file to the record by
    itself, so a looser check would open any private file to whoever could read that record."""
    rows = frappe.get_all("File", filters={"file_url": path}, fields=["name", "owner", "attached_to_doctype"])
    return [r for r in rows if _may_use(r.owner) and (r.attached_to_doctype or OURS[0]) in OURS]


def check(paths) -> None:
    for path in paths or []:
        if path is None or path == "":
            continue
        if not is_file_path(path) or not _usable_rows(path):
            raise RTValidation("Photos must be files uploaded to this server")


def attach(paths, doctype: str, name: str) -> None:
    """A private file is readable by its uploader, or by whoever can read what it's attached to.
    Attached to its record, a photo opens for every role that can read that record."""
    for path in paths or []:
        for row in _usable_rows(path) if path else []:
            if not row.attached_to_doctype:
                frappe.db.set_value("File", row.name, {"attached_to_doctype": doctype, "attached_to_name": name},
                                    update_modified=False)
