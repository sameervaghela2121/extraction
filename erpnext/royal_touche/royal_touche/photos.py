"""Photo fields hold the path of a file uploaded to this server, nothing else. The app turns
these paths into links it opens with the user's login, so an arbitrary value (another endpoint,
another site) must never get in."""

import re

import frappe

from royal_touche.errors import RTValidation

# Plain file names only, matching the app's check. Not a list of what's forbidden: URL libraries
# also read "\\" as "/" and %2e%2e as "..", so anything looser could climb out of files/.
FILE_PATH = re.compile(r"/(private/)?files/[^\W_][\w.() -]*")


def is_file_path(path) -> bool:
    return isinstance(path, str) and ".." not in path and FILE_PATH.fullmatch(path) is not None


def check(paths) -> None:
    for path in paths or []:
        if path is None or path == "":
            continue
        if not is_file_path(path) or not frappe.db.exists("File", {"file_url": path}):
            raise RTValidation("Photos must be files uploaded to this server")
