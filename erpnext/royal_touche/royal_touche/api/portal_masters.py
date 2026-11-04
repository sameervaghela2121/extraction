"""The admin portal's master screens: vendors (Supplier), locations (Warehouse), material types
(Item) and remarks (RT Remark).

Same answers, messages, paging and role rules as the old server:
backend/src/services/{vendors,locations,rawMaterials,remarks}.service.ts, their validators and
routes. A master is a few hundred rows (papers ~1,500), so a search reads the master's rows and
filters, sorts and pages them here. That is what lets the order match the old one exactly:
case-insensitive, "A-2" before "A-10", an unnumbered row last, and creation order breaking ties
so two equal rows never swap places between pages."""

import math
import re
from datetime import timezone

import frappe
from frappe.utils import cint

from royal_touche.api._access import rt_role
from royal_touche.dates import as_ist
from royal_touche.errors import RTConflict, RTDuplicate, RTNotFound, RTValidation
from royal_touche.masters import normalise_code
from royal_touche.portal import GODOWN_WRITE, page_of, page_window, require_roles
from royal_touche.setup.install import COMPANY, UNASSIGNED_WAREHOUSE

PAGE_SIZE = 25  # search.validators.ts DEFAULT_PAGE_SIZE
MAX_QUERY = 100
STATUSES = ("active", "inactive")
ORDERS = ("asc", "desc")
MAX_LISTED_ISSUES = 3

# ---------------------------------------------------------------- shared helpers


def _iso(value) -> str | None:
    if not value:
        return None
    return as_ist(value).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _status(disabled) -> str:
    return "inactive" if cint(disabled) else "active"


def _require_app_user() -> None:
    """requireAuth: anyone signed in to the app, which is anyone holding an app role."""
    if not rt_role():
        raise frappe.PermissionError("You do not have permission to perform this action")


def _require_write() -> None:
    require_roles(*GODOWN_WRITE)


def _paged(items, total, page, page_size) -> dict:
    # Node's paginated(): an empty list reads as page 1 of 1.
    return page_of(items, total, page, page_size)


def _json(value):
    return frappe.parse_json(value) if isinstance(value, str) else value


class _Issues:
    """Node's zodMessage(): up to three problems, each prefixed with its field unless the
    message already names it."""

    def __init__(self):
        self.items: list[tuple[str, str]] = []

    def add(self, field: str, message: str) -> None:
        self.items.append((field, message))

    def raise_any(self) -> None:
        if not self.items:
            return
        seen: list[str] = []
        for field, message in self.items:
            text = f"{field}: {message}" if field and field not in message.lower() else message
            if text not in seen:
                seen.append(text)
            if len(seen) == MAX_LISTED_ISSUES:
                break
        listed = ", ".join(seen)
        remaining = len(self.items) - len(seen)
        raise RTValidation(f"{listed} (and {remaining} more)" if remaining > 0 else listed)


def _type_name(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _enum_issue(issues: _Issues, field: str, value, allowed) -> None:
    expected = " | ".join(f"'{a}'" for a in allowed)
    if isinstance(value, str):
        issues.add(field, f"Invalid enum value. Expected {expected}, received '{value}'")
    else:
        issues.add(field, f"Expected {expected}, received {_type_name(value)}")


def _check_enum(field: str, value, allowed):
    """An optional enum query value; blank means not given."""
    if value is None or value == "":
        return None
    if value not in allowed:
        issues = _Issues()
        _enum_issue(issues, field, value, allowed)
        issues.raise_any()
    return value


def _check_query(q) -> str:
    if q is None:
        return ""
    if not isinstance(q, str):
        raise RTValidation(f"q: Expected string, received {_type_name(q)}")
    q = q.strip()
    if len(q) > MAX_QUERY:
        raise RTValidation(f"q: String must contain at most {MAX_QUERY} character(s)")
    return q


def _check_paper(issues: _Issues, i: int, paper) -> dict | None:
    path = f"papers.{i}"
    if not isinstance(paper, dict):
        issues.add(path, f"Expected object, received {_type_name(paper)}")
        return None
    before = len(issues.items)
    out = {}
    for key in ("royal_touche_code", "delta_code", "supplier_code_number", "found_in"):
        if key in paper:
            value = paper[key]
            if not isinstance(value, str):
                issues.add(f"{path}.{key}", f"Expected string, received {_type_name(value)}")
            else:
                out[key] = value.strip()
    if "is_common" in paper:
        if not isinstance(paper["is_common"], bool):
            issues.add(f"{path}.is_common", f"Expected boolean, received {_type_name(paper['is_common'])}")
        else:
            out["is_common"] = paper["is_common"]
    if len(issues.items) == before and not (out.get("royal_touche_code") or out.get("delta_code")):
        issues.add(f"{path}.royal_touche_code", "A paper needs at least a royal_touche_code or a delta_code")
    return out


def _parse(body, fields, partial: bool) -> dict:
    """The body as the old validators read it: known fields only, strings trimmed.
    fields: (key, kind, required message or None)."""
    body = _json(body) or {}
    if not isinstance(body, dict):
        raise RTValidation(f"Expected object, received {_type_name(body)}")
    issues = _Issues()
    out = {}
    for key, kind, required in fields:
        if key not in body:
            if required and not partial:
                issues.add(key, "Required")
            continue
        value = body[key]
        if kind == "text":
            if not isinstance(value, str):
                issues.add(key, f"Expected string, received {_type_name(value)}")
            elif required and not value.strip():
                issues.add(key, required)
            else:
                out[key] = value.strip()
        elif kind in ("int", "number"):
            if not _is_number(value):
                issues.add(key, f"Expected number, received {_type_name(value)}")
            elif kind == "int" and value != int(value):
                issues.add(key, "Expected integer, received float")
            elif kind == "number" and value < 0:
                issues.add(key, "Number must be greater than or equal to 0")
            else:
                out[key] = int(value) if kind == "int" else value
        elif kind == "status":
            if value not in STATUSES:
                _enum_issue(issues, key, value, STATUSES)
            else:
                out[key] = value
        elif kind == "papers":
            if not isinstance(value, list):
                issues.add(key, f"Expected array, received {_type_name(value)}")
            else:
                out[key] = [_check_paper(issues, i, p) for i, p in enumerate(value)]
        elif kind == "object":
            if not isinstance(value, dict):
                issues.add(key, f"Expected object, received {_type_name(value)}")
            else:
                out[key] = value
    issues.raise_any()
    if partial and not out:
        raise RTValidation("Provide at least one field to update")
    return out


# ---------------------------------------------------------------- ordering

_DIGITS = re.compile(r"([0-9]+)")


def _text_key(value) -> tuple:
    """Case-insensitive, digit runs compared as numbers (Node's en collation with
    numericOrdering). A missing value sorts first, as in MongoDB."""
    if value is None or value == "":
        return ()
    return tuple((0, int(part), "") if part.isdigit() else (1, 0, part.casefold())
                 for part in _DIGITS.split(str(value)) if part)


def _order_key(value) -> float:
    """A missing sort_order sorts after every numbered row. ERPNext stores "none" as 0."""
    return cint(value) or math.inf


def _sort_key(kind: str, value):
    if kind == "order":
        return _order_key(value)
    if kind == "int":
        return cint(value)
    return _text_key(value)


def _ordered(rows: list[dict], keys, order: str | None) -> list[dict]:
    """[keys]: (field, kind) in priority order, all in one direction; `_tie` (creation order)
    always ascending, as the old server's _id tie-breaker was."""
    rows = sorted(rows, key=lambda r: r["_tie"])
    for field, kind in reversed(keys):
        rows.sort(key=lambda r, f=field, k=kind: _sort_key(k, r[f]), reverse=order == "desc")
    return rows


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items() if not k.startswith("_")}


def _matches(row: dict, q: str, fields) -> bool:
    q = q.casefold()
    return any(q in str(row.get(f) or "").casefold() for f in fields)


# ---------------------------------------------------------------- masters


class _Master:
    """One master's doctype, which of its records are portal rows, and how a row reads."""

    doctype: str
    label: str
    code: str  # the code field as the portal names it
    code_column: str
    code_message: str
    sort_column: str | None = None
    filters: list = []
    columns: list[str] = []
    q_fields: tuple = ()
    sorts: dict = {}
    default_sort: str = ""

    @property
    def code_taken(self) -> str:
        return f"A {self.label} with this code already exists"

    def shape(self, d) -> dict:
        raise NotImplementedError

    def list_key(self, row: dict):
        raise NotImplementedError

    def rows(self, status: str | None = None, names: list[str] | None = None) -> list[dict]:
        filters = list(self.filters)
        if status:
            filters.append(["disabled", "=", 1 if status == "inactive" else 0])
        if names is not None:
            filters.append(["name", "in", names])
        out = []
        for d in frappe.get_all(self.doctype, filters=filters, fields=self.columns + ["creation"]):
            row = self.shape(d)
            row["_tie"] = (d.creation, d.name)
            out.append(row)
        return out

    def one(self, id) -> dict:
        if not id or not isinstance(id, str):
            raise RTValidation(f"Invalid {self.label} id")
        rows = self.rows(names=[id])
        if not rows:
            raise RTNotFound(f"{self.label[0].upper()}{self.label[1:]} not found")
        return _public(rows[0])

    def doc(self, id):
        self.one(id)  # same not-found rule as a read
        return frappe.get_doc(self.doctype, id, for_update=True)

    def next_sort_order(self) -> int:
        return max([cint(r.get("sort_order")) for r in self.rows()] or [0]) + 1

    def ensure_code_free(self, code: str, exclude: str | None = None) -> None:
        owner = frappe.db.get_value(self.doctype, {self.code_column: code}, "name")
        if owner and owner != exclude:
            raise RTDuplicate(self.code_taken)


class _Vendors(_Master):
    doctype, label, code, code_column = "Supplier", "vendor", "vendor_code", "rt_vendor_code"
    filters = [["rt_vendor_code", "is", "set"]]
    columns = ["name", "rt_vendor_code", "supplier_name", "rt_address", "tax_id", "mobile_no", "email_id",
               "disabled", "modified"]
    q_fields = ("name", "vendor_code", "gst_number")
    sorts = {"name": [("name", "text")], "vendor_code": [("vendor_code", "text")]}
    default_sort = "name"
    fields = [("vendor_code", "text", "Vendor code is required"), ("name", "text", "Name is required"),
              ("papers", "papers", None), ("contact", "object", None), ("address", "text", None),
              ("gst_number", "text", None), ("status", "status", None)]

    def shape(self, d) -> dict:
        return {"id": d.name, "vendor_code": d.rt_vendor_code, "name": d.supplier_name,
                "contact": {k: v for k, v in (("phone", d.mobile_no), ("email", d.email_id)) if v},
                "address": d.rt_address or None, "gst_number": d.tax_id or None,
                "status": _status(d.disabled), "createdAt": _iso(d.creation), "updatedAt": _iso(d.modified)}

    def list_key(self, row):
        # vendors.service list(): .sort({ name: 1 }) without a collation, i.e. byte order.
        return row["name"] or ""


def _paper_out(p) -> dict:
    """A Vendor Paper row as the old server's embedded paper: absent codes are left out."""
    out = {}
    if p.rt_code:
        out["royal_touche_code"] = p.rt_code
    if p.delta_code:
        out["delta_code"] = p.delta_code
    out["is_common"] = bool(cint(p.is_common))
    if p.paper_code:
        out["supplier_code_number"] = p.paper_code
    if p.found_in:
        out["found_in"] = p.found_in
    return out


def _paper_in(p: dict) -> dict:
    return {"rt_code": p.get("royal_touche_code") or None, "delta_code": p.get("delta_code") or None,
            "paper_code": p.get("supplier_code_number") or None, "found_in": p.get("found_in") or None,
            "is_common": 1 if p.get("is_common") else 0}


def _papers_of(names: list[str] | None = None) -> dict[str, list[dict]]:
    """Each vendor's papers in sheet order (idx)."""
    if names == []:
        return {}
    condition = "AND `parent` IN %(names)s" if names is not None else ""
    rows = frappe.db.sql(
        f"""SELECT `parent`, `paper_code`, `rt_code`, `delta_code`, `is_common`, `found_in`
            FROM `tabVendor Paper` WHERE `parenttype` = 'Supplier' AND `parentfield` = 'rt_papers' {condition}
            ORDER BY `parent`, `idx`""",
        {"names": tuple(names or ())}, as_dict=True)
    out: dict[str, list[dict]] = {}
    for p in rows:
        out.setdefault(p.parent, []).append(_paper_out(p))
    return out


class _Locations(_Master):
    doctype, label, code, code_column = "Warehouse", "location", "location_code", "rt_location_code"
    sort_column = "rt_sort_order"
    filters = [["is_group", "=", 0], ["company", "=", COMPANY], ["rt_location_code", "is", "set"],
               ["name", "!=", UNASSIGNED_WAREHOUSE]]
    columns = ["name", "rt_location_code", "warehouse_name", "rt_godown", "rt_sort_order", "disabled", "modified"]
    q_fields = ("name", "location_code", "godown")
    sorts = {"sort_order": [("sort_order", "order"), ("name", "text")], "location_code": [("location_code", "text")],
             "name": [("name", "text")]}
    default_sort = "sort_order"
    fields = [("location_code", "text", "Location code is required"), ("name", "text", "Name is required"),
              ("godown", "text", None), ("sort_order", "int", None), ("status", "status", None)]

    def shape(self, d) -> dict:
        return {"id": d.name, "location_code": d.rt_location_code, "name": d.warehouse_name,
                "godown": d.rt_godown or None, "sort_order": cint(d.rt_sort_order), "status": _status(d.disabled),
                "createdAt": _iso(d.creation), "updatedAt": _iso(d.modified)}

    def list_key(self, row):
        # locations.service list(): .sort({ sort_order: 1, name: 1 }), byte order.
        return (row["sort_order"], row["name"] or "")


class _Materials(_Master):
    doctype, label, code, code_column = "Item", "material", "material_code", "rt_material_code"
    sort_column = "rt_sort_order"
    filters = [["rt_material_code", "is", "set"]]
    columns = ["name", "rt_material_code", "item_name", "stock_uom", "rt_sort_order", "disabled", "modified"]
    q_fields = ("name", "material_code")
    sorts = {"sort_order": [("sort_order", "order"), ("name", "text")], "material_code": [("material_code", "text")],
             "name": [("name", "text")]}
    default_sort = "sort_order"
    # category, gsm, width_mm, unit and reorder_level are accepted as before but not kept: no
    # screen shows them, the unit is always kg (masters.item_before_validate).
    fields = [("material_code", "text", "Material code is required"), ("name", "text", "Name is required"),
              ("category", "text", None), ("gsm", "number", None), ("width_mm", "number", None),
              ("unit", "text", None), ("reorder_level", "number", None), ("sort_order", "int", None),
              ("status", "status", None)]

    def shape(self, d) -> dict:
        return {"id": d.name, "material_code": d.rt_material_code, "name": d.item_name, "category": None,
                "gsm": None, "width_mm": None, "unit": (d.stock_uom or "kg").lower(), "reorder_level": None,
                "sort_order": cint(d.rt_sort_order), "status": _status(d.disabled),
                "createdAt": _iso(d.creation), "updatedAt": _iso(d.modified)}

    def list_key(self, row):
        # rawMaterials.service list(): unnumbered last, then name (numeric, case-insensitive).
        return (_order_key(row["sort_order"]), _text_key(row["name"]))


class _Remarks(_Master):
    doctype, label, code, code_column = "RT Remark", "remark", "remark_code", "remark_code"
    sort_column = "sort_order"
    columns = ["name", "remark_code", "label", "sort_order", "disabled", "modified"]
    q_fields = ("label", "remark_code")
    sorts = {"sort_order": [("sort_order", "order"), ("label", "text")], "remark_code": [("remark_code", "text")],
             "label": [("label", "text")]}
    default_sort = "sort_order"
    fields = [("remark_code", "text", "Remark code is required"), ("label", "text", "Label is required"),
              ("sort_order", "int", None), ("status", "status", None)]

    def shape(self, d) -> dict:
        return {"id": d.name, "remark_code": d.remark_code, "label": d.label, "sort_order": cint(d.sort_order),
                "status": _status(d.disabled), "createdAt": _iso(d.creation), "updatedAt": _iso(d.modified)}

    def list_key(self, row):
        # remarks.service list(): .sort({ sort_order: 1, label: 1 }), byte order.
        return (row["sort_order"], row["label"] or "")


VENDORS, LOCATIONS, MATERIALS, REMARKS = _Vendors(), _Locations(), _Materials(), _Remarks()


# ---------------------------------------------------------------- generic operations


def _list(m: _Master, q=None, status=None) -> list[dict]:
    q = _check_query(q)
    status = _check_enum("status", status, STATUSES)
    rows = m.rows(status)
    if q:
        rows = [r for r in rows if _matches(r, q, m.q_fields)]
    rows = sorted(sorted(rows, key=lambda r: r["_tie"]), key=m.list_key)
    if m is VENDORS:
        papers = _papers_of([r["id"] for r in rows])
        return [_vendor_with_papers(_public(r), papers.get(r["id"], [])) for r in rows]
    return [_public(r) for r in rows]


def _vendor_with_papers(row: dict, papers: list[dict]) -> dict:
    out = {k: row[k] for k in ("id", "vendor_code", "name")}
    out["papers"] = papers
    out.update({k: v for k, v in row.items() if k not in out})
    return out


def _search(m: _Master, page, pageSize, q, sort, order, status) -> dict:
    page, size, offset = page_window(page, pageSize, PAGE_SIZE)
    q = _check_query(q)
    sort = _check_enum("sort", sort, tuple(m.sorts))
    order = _check_enum("order", order, ORDERS)
    status = _check_enum("status", status, STATUSES)
    rows = m.rows(status)
    if q:
        rows = [r for r in rows if _matches(r, q, m.q_fields)]
    rows = _ordered(rows, m.sorts[sort or m.default_sort], order)
    return _paged([_public(r) for r in rows[offset:offset + size]], len(rows), page, size)


def _get(m: _Master, id) -> dict:
    row = m.one(id)
    if m is VENDORS:
        return _vendor_with_papers(row, _papers_of([row["id"]]).get(row["id"], []))
    return row


def _insert(m: _Master, doc, set_name: str | None = None):
    try:
        doc.insert(ignore_permissions=True, set_name=set_name)
    except frappe.UniqueValidationError:
        # Someone took the code between the check and the insert.
        frappe.clear_messages()
        raise RTDuplicate(m.code_taken)
    return doc


def _save(m: _Master, doc):
    doc.flags.ignore_permissions = True
    try:
        doc.save()
    except frappe.UniqueValidationError:
        frappe.clear_messages()
        raise RTDuplicate(m.code_taken)
    return doc


def _free_name(doctype: str, candidate) -> str | None:
    """None when candidate(0) is free (the doctype's own naming gives it); else the first free
    candidate(n). The old server let two masters share a name; ERPNext names some by it."""
    n = 0
    while frappe.db.exists(doctype, candidate(n)):
        n += 1
    return candidate(n) if n else None


def _remove(m: _Master, id) -> dict:
    doc = m.doc(id)
    doc.disabled = 1
    _save(m, doc)
    return {"id": doc.name, "status": "inactive"}


def _reorder(m: _Master, ids, offset=None) -> list[dict]:
    """utils/crud.ts reorderDocs(): without [offset], [ids] is the whole order and is numbered
    1..N; with it, [ids] is one page starting at [offset] in the full sort_order order, which is
    slotted back in and the whole list renumbered."""
    ids = _json(ids)
    issues = _Issues()
    if not isinstance(ids, list):
        issues.add("ids", f"Expected array, received {_type_name(ids)}")
    else:
        for i, value in enumerate(ids):
            if not isinstance(value, str):
                issues.add(f"ids.{i}", f"Expected string, received {_type_name(value)}")
        if not ids:
            issues.add("ids", f"Provide at least one {m.label} id")
    if offset is not None and offset != "":
        offset = _json(offset)
        if not _is_number(offset):
            issues.add("offset", f"Expected number, received {_type_name(offset)}")
        elif offset != int(offset):
            issues.add("offset", "Expected integer, received float")
        elif offset < 0:
            issues.add("offset", "Number must be greater than or equal to 0")
    else:
        offset = None
    issues.raise_any()
    if len(set(ids)) != len(ids):
        raise RTValidation(f"The same {m.label} appears twice in the new order")

    rows = m.rows()
    current_order = {r["id"]: r["sort_order"] for r in rows}
    if offset is not None:
        offset = int(offset)
        current = [r["id"] for r in _ordered(rows, m.sorts["sort_order"], "asc")]
        window = current[offset:offset + len(ids)]
        if len(window) != len(ids) or set(window) != set(ids):
            raise RTConflict(f"The {m.label} list changed since it was loaded — reload and try again")
        sequence = current[:offset] + ids + current[offset + len(ids):]
    else:
        if any(i not in current_order for i in ids):
            raise RTValidation(f"One or more {m.label} ids were not found")
        sequence = ids

    for position, name in enumerate(sequence, start=1):
        if current_order.get(name) != position:
            # set_value moves `modified`, so the tablets' delta pull picks up the new order.
            frappe.db.set_value(m.doctype, name, m.sort_column, position)
    return _list(m)


# ---------------------------------------------------------------- vendors


@frappe.whitelist(methods=["GET"])
def vendors_list(q=None, status=None) -> list[dict]:
    _require_app_user()
    return _list(VENDORS, q, status)


@frappe.whitelist(methods=["GET", "POST"])
def vendors_search(page=None, pageSize=None, q=None, sort=None, order=None, status=None) -> dict:
    """The vendor table: vendors without their papers, which have their own screen."""
    _require_app_user()
    return _search(VENDORS, page, pageSize, q, sort, order, status)


PAPER_SORTS = {
    "vendor": [("_vendor_name", "text"), ("index", "int")],
    "royal_touche_code": [("_rt", "text")],
    "delta_code": [("_delta", "text")],
    "supplier_code_number": [("_supplier", "text")],
}


@frappe.whitelist(methods=["GET", "POST"])
def vendors_search_papers(page=None, pageSize=None, q=None, sort=None, order=None) -> dict:
    """The paper-codes screen: every vendor's papers, one row per paper. A row is addressed by
    its vendor and its position in that vendor's papers (`index`), which is what an edit
    sends back as the vendor's whole papers list."""
    _require_app_user()
    page, size, offset = page_window(page, pageSize, PAGE_SIZE)
    q = _check_query(q).casefold()
    sort = _check_enum("sort", sort, tuple(PAPER_SORTS))
    order = _check_enum("order", order, ORDERS)
    vendors = {d.name: d for d in frappe.get_all("Supplier", filters=VENDORS.filters,
                                                   fields=["name", "supplier_name", "rt_vendor_code", "creation"])}
    rows = []
    for parent, papers in _papers_of().items():
        v = vendors.get(parent)
        if not v:
            continue
        for index, paper in enumerate(papers):
            row = {"vendor": {"id": v.name, "name": v.supplier_name, "vendor_code": v.rt_vendor_code},
                   "index": index, "paper": paper, "_tie": (v.creation, v.name, index),
                   "_vendor_name": v.supplier_name, "_rt": paper.get("royal_touche_code"),
                   "_delta": paper.get("delta_code"), "_supplier": paper.get("supplier_code_number")}
            if q and not any(q in str(row[f] or "").casefold() for f in ("_rt", "_delta", "_supplier", "_vendor_name")):
                continue
            rows.append(row)
    rows = _ordered(rows, PAPER_SORTS[sort or "vendor"], order)
    return _paged([_public(r) for r in rows[offset:offset + size]], len(rows), page, size)


@frappe.whitelist(methods=["GET"])
def vendors_get(id=None) -> dict:
    _require_app_user()
    return _get(VENDORS, id)


def _supplier_group() -> str:
    return frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups"


@frappe.whitelist(methods=["POST"])
def vendors_create(body=None) -> dict:
    _require_write()
    data = _parse(body, VENDORS.fields, partial=False)
    code = normalise_code(data["vendor_code"])
    VENDORS.ensure_code_free(code)
    doc = frappe.get_doc({
        "doctype": "Supplier",
        "supplier_name": data["name"],
        "supplier_group": _supplier_group(),
        "rt_vendor_code": code,
        "rt_papers": [_paper_in(p) for p in data.get("papers") or []],
        "rt_address": data.get("address") or None,
        "tax_id": (data.get("gst_number") or "").upper() or None,
        "disabled": 1 if data.get("status") == "inactive" else 0,
    })
    set_name = None
    if frappe.defaults.get_global_default("supp_master_name") == "Supplier Name":
        set_name = _free_name("Supplier", lambda n: data["name"] if not n else f"{data['name']}-{n}")
    _insert(VENDORS, doc, set_name)
    return _get(VENDORS, doc.name)


@frappe.whitelist(methods=["POST", "PUT", "PATCH"])
def vendors_update(id=None, body=None) -> dict:
    """A PATCH: only the fields sent change. `papers` replaces the vendor's whole list (the
    paper-codes screen edits it as a set); `contact` is accepted but not kept (ERPNext keeps
    contacts as Contact records, and no screen edits them)."""
    _require_write()
    data = _parse(body, VENDORS.fields, partial=True)
    doc = VENDORS.doc(id)
    if data.get("vendor_code"):
        code = normalise_code(data["vendor_code"])
        if code != doc.rt_vendor_code:
            VENDORS.ensure_code_free(code, exclude=doc.name)
            doc.rt_vendor_code = code
    if "name" in data:
        doc.supplier_name = data["name"]
    if "papers" in data:
        doc.set("rt_papers", [_paper_in(p) for p in data["papers"]])
    if "address" in data:
        doc.rt_address = data["address"]
    if "gst_number" in data:
        doc.tax_id = data["gst_number"].upper()
    if "status" in data:
        doc.disabled = 1 if data["status"] == "inactive" else 0
    _save(VENDORS, doc)
    return _get(VENDORS, doc.name)


@frappe.whitelist(methods=["POST", "DELETE"])
def vendors_remove(id=None) -> dict:
    """Soft delete: the vendor stays (rolls point at it), just inactive."""
    _require_write()
    return _remove(VENDORS, id)


# ---------------------------------------------------------------- locations


@frappe.whitelist(methods=["GET"])
def locations_list(q=None, status=None) -> list[dict]:
    _require_app_user()
    return _list(LOCATIONS, q, status)


@frappe.whitelist(methods=["GET", "POST"])
def locations_search(page=None, pageSize=None, q=None, sort=None, order=None, status=None) -> dict:
    _require_app_user()
    return _search(LOCATIONS, page, pageSize, q, sort, order, status)


@frappe.whitelist(methods=["GET"])
def locations_get(id=None) -> dict:
    _require_app_user()
    return _get(LOCATIONS, id)


@frappe.whitelist(methods=["POST"])
def locations_create(body=None) -> dict:
    _require_write()
    data = _parse(body, LOCATIONS.fields, partial=False)
    code = normalise_code(data["location_code"])
    LOCATIONS.ensure_code_free(code)
    sort_order = data["sort_order"] if "sort_order" in data else LOCATIONS.next_sort_order()
    doc = frappe.get_doc({
        "doctype": "Warehouse",
        "warehouse_name": data["name"],
        "company": COMPANY,
        "rt_location_code": code,
        "rt_godown": data.get("godown") or None,
        "rt_sort_order": sort_order,
        "disabled": 1 if data.get("status") == "inactive" else 0,
    })
    abbr = frappe.get_cached_value("Company", COMPANY, "abbr")
    set_name = _free_name("Warehouse", lambda n: f"{data['name']}{f'-{n}' if n else ''} - {abbr}")
    _insert(LOCATIONS, doc, set_name)
    return _get(LOCATIONS, doc.name)


@frappe.whitelist(methods=["POST", "PUT", "PATCH"])
def locations_update(id=None, body=None) -> dict:
    _require_write()
    data = _parse(body, LOCATIONS.fields, partial=True)
    doc = LOCATIONS.doc(id)
    if data.get("location_code"):
        code = normalise_code(data["location_code"])
        if code != doc.rt_location_code:
            LOCATIONS.ensure_code_free(code, exclude=doc.name)
            doc.rt_location_code = code
    if "name" in data:
        doc.warehouse_name = data["name"]
    if "godown" in data:
        doc.rt_godown = data["godown"]
    if "sort_order" in data:
        doc.rt_sort_order = data["sort_order"]
    if "status" in data:
        doc.disabled = 1 if data["status"] == "inactive" else 0
    _save(LOCATIONS, doc)
    return _get(LOCATIONS, doc.name)


@frappe.whitelist(methods=["POST", "DELETE"])
def locations_remove(id=None) -> dict:
    _require_write()
    return _remove(LOCATIONS, id)


@frappe.whitelist(methods=["POST"])
def locations_reorder(ids=None, offset=None) -> list[dict]:
    _require_write()
    return _reorder(LOCATIONS, ids, offset)


# ---------------------------------------------------------------- material types (Item)


@frappe.whitelist(methods=["GET"])
def materials_list(q=None, status=None) -> list[dict]:
    _require_app_user()
    return _list(MATERIALS, q, status)


@frappe.whitelist(methods=["GET", "POST"])
def materials_search(page=None, pageSize=None, q=None, sort=None, order=None, status=None) -> dict:
    _require_app_user()
    return _search(MATERIALS, page, pageSize, q, sort, order, status)


@frappe.whitelist(methods=["GET"])
def materials_get(id=None) -> dict:
    _require_app_user()
    return _get(MATERIALS, id)


def _item_group() -> str:
    if frappe.db.exists("Item Group", "Raw Material"):
        return "Raw Material"
    return frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"


@frappe.whitelist(methods=["POST"])
def materials_create(body=None) -> dict:
    _require_write()
    data = _parse(body, MATERIALS.fields, partial=False)
    code = normalise_code(data["material_code"])
    MATERIALS.ensure_code_free(code)
    sort_order = data["sort_order"] if "sort_order" in data else MATERIALS.next_sort_order()
    # The Item is named by its code. A material whose code was changed keeps its first name,
    # so a later material may need a suffixed one; rt_material_code is the code either way.
    item_code = _free_name("Item", lambda n: f"{code}-{n}" if n else code) or code
    doc = frappe.get_doc({
        "doctype": "Item",
        "item_code": item_code,
        "item_name": data["name"],
        "item_group": _item_group(),
        "rt_material_code": code,
        "rt_sort_order": sort_order,
        "disabled": 1 if data.get("status") == "inactive" else 0,
    })
    _insert(MATERIALS, doc)
    return _get(MATERIALS, doc.name)


@frappe.whitelist(methods=["POST", "PUT", "PATCH"])
def materials_update(id=None, body=None) -> dict:
    _require_write()
    data = _parse(body, MATERIALS.fields, partial=True)
    doc = MATERIALS.doc(id)
    if data.get("material_code"):
        code = normalise_code(data["material_code"])
        if code != doc.rt_material_code:
            MATERIALS.ensure_code_free(code, exclude=doc.name)
            doc.rt_material_code = code
    if "name" in data:
        doc.item_name = data["name"]
    if "sort_order" in data:
        doc.rt_sort_order = data["sort_order"]
    if "status" in data:
        doc.disabled = 1 if data["status"] == "inactive" else 0
    _save(MATERIALS, doc)
    return _get(MATERIALS, doc.name)


@frappe.whitelist(methods=["POST", "DELETE"])
def materials_remove(id=None) -> dict:
    _require_write()
    return _remove(MATERIALS, id)


@frappe.whitelist(methods=["POST"])
def materials_reorder(ids=None, offset=None) -> list[dict]:
    _require_write()
    return _reorder(MATERIALS, ids, offset)


# ---------------------------------------------------------------- remarks


@frappe.whitelist(methods=["GET"])
def remarks_list(q=None, status=None) -> list[dict]:
    _require_app_user()
    return _list(REMARKS, q, status)


@frappe.whitelist(methods=["GET", "POST"])
def remarks_search(page=None, pageSize=None, q=None, sort=None, order=None, status=None) -> dict:
    _require_app_user()
    return _search(REMARKS, page, pageSize, q, sort, order, status)


@frappe.whitelist(methods=["GET"])
def remarks_get(id=None) -> dict:
    _require_app_user()
    return _get(REMARKS, id)


@frappe.whitelist(methods=["POST"])
def remarks_create(body=None) -> dict:
    _require_write()
    data = _parse(body, REMARKS.fields, partial=False)
    code = normalise_code(data["remark_code"])
    REMARKS.ensure_code_free(code)
    sort_order = data["sort_order"] if "sort_order" in data else REMARKS.next_sort_order()
    doc = frappe.get_doc({
        "doctype": "RT Remark",
        "remark_code": code,
        "label": data["label"],
        "sort_order": sort_order,
        "disabled": 1 if data.get("status") == "inactive" else 0,
    })
    _insert(REMARKS, doc)
    return _get(REMARKS, doc.name)


@frappe.whitelist(methods=["POST", "PUT", "PATCH"])
def remarks_update(id=None, body=None) -> dict:
    _require_write()
    data = _parse(body, REMARKS.fields, partial=True)
    doc = REMARKS.doc(id)
    if data.get("remark_code"):
        code = normalise_code(data["remark_code"])
        if code != doc.remark_code:
            REMARKS.ensure_code_free(code, exclude=doc.name)
            doc.remark_code = code
    if "label" in data:
        doc.label = data["label"]
    if "sort_order" in data:
        doc.sort_order = data["sort_order"]
    if "status" in data:
        doc.disabled = 1 if data["status"] == "inactive" else 0
    _save(REMARKS, doc)
    return _get(REMARKS, doc.name)


@frappe.whitelist(methods=["POST", "DELETE"])
def remarks_remove(id=None) -> dict:
    _require_write()
    return _remove(REMARKS, id)


@frappe.whitelist(methods=["POST"])
def remarks_reorder(ids=None, offset=None) -> list[dict]:
    _require_write()
    return _reorder(REMARKS, ids, offset)
