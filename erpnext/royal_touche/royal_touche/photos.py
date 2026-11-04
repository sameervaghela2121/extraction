"""Photo fields hold the path of a file uploaded to this server, nothing else. The app turns
these paths into links it opens with the user's login, so an arbitrary value (another endpoint,
another site) must never get in."""

import re

import frappe

from royal_touche.errors import RTValidation

FILE_PATH = re.compile(r"^/(private/)?files/[^/?#]+$")


def check(paths) -> None:
    for path in paths or []:
        if path is None or path == "":
            continue
        is_file = isinstance(path, str) and ".." not in path and FILE_PATH.match(path)
        if not is_file or not frappe.db.exists("File", {"file_url": path}):
            raise RTValidation("Photos must be files uploaded to this server")
