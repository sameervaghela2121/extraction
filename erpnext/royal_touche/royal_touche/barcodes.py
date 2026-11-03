"""Pre-printed label runs. Only the recipe is stored (prefix + date + range); the codes are
regenerated from it exactly as backend/src/services/barcodeBatches.service.ts does."""

import frappe
from frappe.utils import getdate

from royal_touche.masters import normalise_code


def date_digits(date) -> str:
    """2026-11-03 → "261103"."""
    return getdate(date).strftime("%y%m%d")


def code_width(from_number: int, to_number: int) -> int:
    """At least 3 digits, or as many as the largest number in the run needs."""
    return max(3, len(str(max(from_number, to_number))))


def next_number(prefix: str, date) -> int:
    # Deleted runs count: their labels may already be stuck on rolls, so their numbers stay spent.
    highest = frappe.get_all(
        "Barcode Batch",
        filters={"prefix": normalise_code(prefix) or "", "date": getdate(date)},
        pluck="to_number",
        order_by="to_number desc",
        limit=1,
    )
    return (highest[0] if highest else 0) + 1


def codes_of(batch_name: str) -> list[str]:
    b = frappe.db.get_value("Barcode Batch", batch_name, ["prefix", "date", "from_number", "to_number"], as_dict=True)
    head = f"{b.prefix}{date_digits(b.date)}"
    width = code_width(b.from_number, b.to_number)
    return [f"{head}{str(n).zfill(width)}" for n in range(b.from_number, b.to_number + 1)]
