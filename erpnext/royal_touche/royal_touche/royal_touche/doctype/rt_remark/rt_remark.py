from frappe.model.document import Document

from royal_touche.masters import normalise_code


class RTRemark(Document):
    def validate(self):
        self.remark_code = normalise_code(self.remark_code)
        self.label = (self.label or "").strip()
