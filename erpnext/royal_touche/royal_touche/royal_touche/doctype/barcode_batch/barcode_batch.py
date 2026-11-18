import frappe
from frappe.model.document import Document

from royal_touche.errors import RTConflict, RTValidation
from royal_touche.masters import normalise_code

MAX_BATCH_LABELS = 500


class BarcodeBatch(Document):
    def validate(self):
        self.prefix = normalise_code(self.prefix)
        if not self.prefix:
            raise RTValidation("Enter the letters the code starts with")
        if self.to_number < self.from_number:
            raise RTValidation("The end number is lower than the start number")
        count = self.to_number - self.from_number + 1
        if count > MAX_BATCH_LABELS:
            raise RTValidation(f"That's {count} labels — {MAX_BATCH_LABELS} at a time is the limit")
        # The same physical numbers can't be saved twice, deleted or not, whatever their kind.
        if self.is_new() and frappe.db.exists(
            "Barcode Batch",
            {"prefix": self.prefix, "date": self.date, "from_number": self.from_number, "to_number": self.to_number},
        ):
            raise RTConflict("That exact run has already been saved")


def on_doctype_update():
    """A run's numbers are spent once saved, deleted or not: the database refuses a second copy
    of one even when two saves race past validate(). Also applied by setup.install.ensure_setup."""
    frappe.db.add_unique("Barcode Batch", ["prefix", "date", "from_number", "to_number"], constraint_name="rt_unique_run")
