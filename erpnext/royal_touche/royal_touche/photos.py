"""Photo fields hold the path of a file uploaded to this server, nothing else. The app turns
these paths into links it opens with the user's login, so an arbitrary value (another endpoint,
another site) must never get in."""

import re

import frappe

from royal_touche.api._access import rt_role
from royal_touche.errors import RTValidation

OURS = ("Batch", "Roll Movement", "Roll Lot")

# Plain file names only, matching the app's check. Not a list of what's forbidden: URL libraries
# also read "\\" as "/" and %2e%2e as "..", so anything looser could climb out of files/.
FILE_PATH = re.compile(r"/(private/)?files/[^\W_][\w.() -]*")


def is_file_path(path) -> bool:
    return isinstance(path, str) and ".." not in path and FILE_PATH.fullmatch(path) is not None


def _usable_rows(path: str) -> list:
    """Upload rows for this path that the app may use: uploaded by someone with an app role, and
    not belonging to anything else. ERPNext attaches an Attach field's file to the record by
    itself, so a looser check would open any private file to whoever could read that record."""
    rows = frappe.get_all("File", filters={"file_url": path}, fields=["name", "owner", "attached_to_doctype"])
    return [r for r in rows if rt_role(r.owner) and (r.attached_to_doctype or OURS[0]) in OURS]


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
