from frappe.model.document import Document

from royal_touche.errors import RTValidation

DOCUMENT_TYPES = ("challan", "invoice")


class RollLot(Document):
    def validate(self):
        self.document_type = (self.document_type or "").strip().lower()
        if self.document_type not in DOCUMENT_TYPES:
            raise RTValidation("Pick challan or invoice")
        self.document_no = (self.document_no or "").strip()
        if not self.document_no:
            raise RTValidation("Challan or invoice number is required")
        if len(self.document_no) > 100:
            raise RTValidation("Challan or invoice number can be at most 100 characters")
