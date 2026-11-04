"""The admin portal's rolls and their movement history, answering in the old Node server's shapes
and messages (backend/src/services/materialRolls.service.ts toResponse/list/get/create/update/
remove, backend/src/services/stock.service.ts listMovements/toResponse, the validators, and the
role rules in backend/src/routes/{materialRolls,stock}.routes.ts).

The rules themselves live in royal_touche.rolls and royal_touche.movements; this module only
translates the portal's field names to theirs and their records back to Node's response shape.

Photos: Node answered with signed links. ERPNext's private files need the login token, so the
portal turns the returned paths into links itself (frontend/src/api/client.ts fileObjectUrl);
the *_url fields leave here empty."""

from datetime import datetime, time, timezone

import frappe
from frappe.utils import cint, flt, get_datetime

from royal_touche import roll_corrections, rolls
from royal_touche.api._access import without_prices
from royal_touche.dates import as_ist, as_system
from royal_touche.errors import RTValidation
from royal_touche.movements import movement_dict
from royal_touche.portal import GODOWN_WRITE, page_of, page_window, require_roles

# Node's photo fields → the roll's (rolls.PHOTO_KEYS), in Node's PHOTO_FIELDS order.
PHOTO_FIELDS = (
    ("tag_photo_path", "tag_photo", "tag_photo_url"),
    ("stitched_barcode_photo_path", "barcode_photo", "stitched_barcode_photo_url"),
    ("side1_photo_path", "side1_photo", "side1_photo_url"),
    ("side2_photo_path", "side2_photo", "side2_photo_url"),
)
# The old validators' page sizes: GET list 50 (max 200), POST search 25 (max 100), movements 50.
LIST_PAGE_SIZE, SEARCH_PAGE_SIZE, MOVEMENTS_PAGE_SIZE = 50, 25, 50
SORT_KEYS = ("roll_number", "date")
MAX_PAPERS = 10
# Registration's refusal of a remaining weight that differs from the arrival weight.
STOCK_EDIT = "Stock changes must be recorded as a movement, not edited on the roll"
# Node's PATCH body → update_roll's names. Anything else Node accepted is refused by update_roll.
UPDATE_NAMES = {"roll_number": "roll_number", "barcode": "barcode", "gsm": "gsm", "width": "width",
                "lot_id": "lot", **{node: ours for node, ours, _ in PHOTO_FIELDS}}
# Node's PATCH body → roll_corrections' names: the figures and places behind the roll's stock.
CORRECTION_NAMES = {"weight": "weight", "remaining_weight": "remaining_weight", "material_id": "material",
                    "location": "location"}
# The first-registered IN movement is the roll's arrival: Node's roll `date`.
RECEIVED = ("(select rm.transaction_date from `tabRoll Movement` rm where rm.roll = b.name"
            " and rm.movement_type = 'IN' order by rm.creation asc, rm.name asc limit 1)")


# ---- reads ----

@frappe.whitelist(methods=["GET"])
def list_rolls(q: str | None = None, page: int | str | None = None, pageSize: int | str | None = None,
               sort: str | None = None, order: str | None = None) -> dict:
    """GET /material-rolls: the app's and the barcode screen's paged list."""
    require_roles(*GODOWN_WRITE)
    return _page(q, sort, order, *page_window(page, pageSize, LIST_PAGE_SIZE))


@frappe.whitelist(methods=["GET", "POST"])
def search(q: str | None = None, sort: str | None = None, order: str | None = None,
           page: int | str | None = None, pageSize: int | str | None = None) -> dict:
    """POST /material-rolls/search: the Rolls screen's paged, sorted list of full rolls."""
    require_roles(*GODOWN_WRITE)
    return _page(q, sort, order, *page_window(page, pageSize, SEARCH_PAGE_SIZE))


@frappe.whitelist(methods=["GET"])
def get(id: str) -> dict:
    """GET /material-rolls/:id — by id, roll number or barcode, any case."""
    require_roles(*GODOWN_WRITE)
    return roll_response(rolls.find_roll(id))


@frappe.whitelist(methods=["GET"])
def movements(roll_id: str | None = None, roll_number: str | None = None, material_id: str | None = None,
              transaction_type: str | None = None, page: int | str | None = None,
              pageSize: int | str | None = None) -> dict:
    """GET /stock/movements: a roll's history, newest first. Its total says whether the roll
    has moved since it arrived (registration writes exactly one IN)."""
    require_roles(*GODOWN_WRITE)
    page, page_size, offset = page_window(page, pageSize, MOVEMENTS_PAGE_SIZE)
    filters = {"deleted": 0}
    if roll_id:
        filters["roll"] = roll_id
    if material_id:
        filters["material"] = material_id
    if transaction_type:
        filters["movement_type"] = transaction_type
    if roll_number:
        # An unknown number is no history, not the whole ledger.
        roll = frappe.db.get_value("Batch", {"rt_roll_key": roll_number.strip().upper()}, "name")
        if not roll:
            return page_of([], 0, page, page_size)
        filters["roll"] = roll
    names = frappe.get_all("Roll Movement", filters=filters, pluck="name", start=offset, page_length=page_size,
                           order_by="transaction_date desc, creation desc, name desc")
    total = frappe.db.count("Roll Movement", filters)
    refs = _Refs()
    return page_of([movement_response(n, refs) for n in names], total, page, page_size)


# ---- writes ----

@frappe.whitelist(methods=["POST"])
def create(**body) -> dict:
    """POST /material-rolls: registers the roll; its IN movement is written with it."""
    require_roles(*GODOWN_WRITE)
    body.pop("cmd", None)
    _check_create(body)
    if not body.get("lot_id"):
        raise RTValidation("Select the lot (challan or invoice) this roll came in on")
    remaining = body.get("remaining_weight")
    if remaining is not None and flt(remaining) != flt(body["weight"]):
        if flt(remaining) > flt(body["weight"]):
            raise RTValidation(f"A roll cannot hold more than the {_num(body['weight'])} "
                               f"{body.get('unit') or 'kg'} it arrived with")
        raise RTValidation(STOCK_EDIT)
    data = {
        "roll_number": body.get("roll_number"),
        "barcode": body.get("barcode"),
        "lot": body["lot_id"],
        "material": body["material_id"],
        "vendor": body["vendor_id"],
        "location": body["location"],
        "weight": body["weight"],
        "gsm": body["gsm"],
        "width": body["width"],
        "date": body["date"],
        "client_id": body.get("client_id"),
        **_paper_codes(body),
        **{ours: body.get(node) or None for node, ours, _ in PHOTO_FIELDS},
    }
    return roll_response(rolls.register_roll(data)["name"])


@frappe.whitelist(methods=["POST", "PUT", "PATCH"])
def update(id: str, **changes) -> dict:
    """PATCH /material-rolls/:id: corrects what was read off the label (rolls.update_roll) and
    the roll's weight, material and location (roll_corrections: the registration itself while
    the roll has not moved, through its ledger once it has). Status moves only through
    movements. One PATCH is applied whole or not at all."""
    require_roles(*GODOWN_WRITE)
    changes.pop("cmd", None)
    if not changes:
        raise RTValidation("Provide at least one field to update")
    if "status" in changes:
        raise RTValidation("A roll's status follows its movements — issue or consume it instead")
    if "client_id" in changes:
        raise RTValidation("client_id is set when the roll is created and cannot be changed")
    if "papers" in changes:
        _check_papers(changes["papers"])
    ours, corrections = {}, {}
    for key, value in changes.items():
        if key in ("papers", "royal_touche_code"):
            continue
        if key in CORRECTION_NAMES:
            corrections[CORRECTION_NAMES[key]] = value
        else:
            ours[UPDATE_NAMES.get(key, key)] = value
    if "papers" in changes or "royal_touche_code" in changes:
        ours.update(_paper_codes(changes))
    name = rolls.find_roll(id)
    with roll_corrections.atomic():
        # Checked before anything is written; the label fields are checked as they are saved.
        plan = roll_corrections.plan_correction(name, corrections) if corrections else None
        if ours:
            rolls.update_roll(name, ours)
        if plan:
            roll_corrections.apply_correction(plan)
    return roll_response(name)


@frappe.whitelist(methods=["POST", "DELETE"])
def remove(id: str) -> dict:
    """DELETE /material-rolls/:id: soft — the roll and its movements are kept, marked deleted."""
    require_roles(*GODOWN_WRITE)
    rolls.delete_roll(rolls.find_roll(id))
    return {"id": id, "deleted": True}


# Whitelisted under the names the portal calls; defined last so the module's own code keeps
# Python's built-in list.
list = list_rolls  # noqa: A001


# ---- Node's response shapes ----

class _Refs:
    """Each master looked up once per request, not once per roll on a page."""

    def __init__(self):
        self.cache = {}

    def get(self, doctype, name, fields):
        if not name:
            return None
        key = (doctype, name)
        if key not in self.cache:
            self.cache[key] = frappe.db.get_value(doctype, name, fields, as_dict=True)
        return self.cache[key]

    def material(self, name):
        m = self.get("Item", name, ["item_name"])
        return {"id": name, "name": m.item_name if m else None}

    def vendor(self, name, with_code=True):
        if not name:
            return None
        v = self.get("Supplier", name, ["supplier_name", "rt_vendor_code"])
        ref = {"id": name, "name": v.supplier_name if v else None}
        if with_code:
            ref["vendor_code"] = v.rt_vendor_code if v else None
        return ref

    def location(self, name):
        if not name:
            return None
        w = self.get("Warehouse", name, ["rt_location_code", "warehouse_name"])
        return {"id": name, "location_code": w.rt_location_code if w else None,
                "name": w.warehouse_name if w else None}

    def lot(self, name):
        if not name:
            return None
        lot = self.get("Roll Lot", name, ["document_type", "document_no"])
        return {"id": name, "document_type": lot.document_type if lot else None,
                "document_no": lot.document_no if lot else None}

    def user(self, name):
        u = self.get("User", name, ["full_name"])
        return {"id": name, "name": u.full_name if u else None}

    def vendor_papers(self, vendor):
        key = ("Vendor Paper", vendor)
        if key not in self.cache:
            self.cache[key] = frappe.get_all("Vendor Paper", filters={"parent": vendor, "parenttype": "Supplier"},
                                             fields=["paper_code", "rt_code", "delta_code", "is_common", "found_in"])
        return self.cache[key]


def roll_response(name: str, refs: _Refs | None = None) -> dict:
    """materialRolls.service.ts toResponse. Keys Node left undefined are absent here too."""
    refs = refs or _Refs()
    b = frappe.db.get_value("Batch", name, [
        "name", "item", "rt_roll_number", "rt_barcode", "rt_status", "rt_original_weight", "rt_remaining_weight",
        "rt_location", "rt_vendor", "rt_lot", "rt_paper_code", "rt_rt_code", "rt_delta_code", "rt_gsm",
        "rt_width", "rt_tag_photo", "rt_barcode_photo", "rt_side1_photo", "rt_side2_photo", "rt_client_id",
        "rt_deleted", "creation", "modified"], as_dict=True)
    received = frappe.db.get_value("Roll Movement", {"roll": name, "movement_type": "IN"}, "transaction_date",
                                   order_by="creation asc")
    remarks = frappe.get_all("RT Remark Link", filters={"parent": name, "parenttype": "Batch",
                                                        "parentfield": "rt_remark_codes"},
                             pluck="remark", order_by="idx asc")
    out = {
        "id": b.name,
        "roll_number": b.rt_roll_number,
        "royal_touche_code": b.rt_rt_code or None,
        "papers": _papers(b, refs),
        "barcode": b.rt_barcode or None,
        "remark_codes": [_remark(r, refs) for r in remarks] or None,
        "material_id": refs.material(b.item),
        "vendor_id": refs.vendor(b.rt_vendor),
        "lot": refs.lot(b.rt_lot),
        "weight": flt(b.rt_original_weight),
        "remaining_weight": flt(b.rt_remaining_weight),
        "unit": "kg",
        "gsm": flt(b.rt_gsm),
        "width": flt(b.rt_width),
        "location": refs.location(b.rt_location),
        "date": iso_date(received) if received else None,
        "status": b.rt_status,
        **{node: b.get(f"rt_{ours}") or None for node, ours, _ in PHOTO_FIELDS},
        **{url: None for _, _, url in PHOTO_FIELDS},
        "client_id": b.rt_client_id or None,
        "deleted_at": iso(b.modified) if b.rt_deleted else None,
        "createdAt": iso(b.creation),
        "updatedAt": iso(b.modified),
    }
    always = {"lot", "location", "deleted_at", "papers", "material_id", "date", "status"} | {
        url for _, _, url in PHOTO_FIELDS}
    return {k: v for k, v in out.items() if v is not None or k in always}


def movement_response(name: str, refs: _Refs | None = None) -> dict:
    """stock.service.ts toResponse, plus ERPNext's sale fields; prices only for those who may see them."""
    refs = refs or _Refs()
    mv = movement_dict(name)
    extra = frappe.db.get_value("Roll Movement", name, ["owner"], as_dict=True)
    roll_number = refs.get("Batch", mv["roll"], ["rt_roll_number"])
    out = {
        "id": mv["name"],
        "transaction_type": mv["movement_type"],
        "transaction_date": iso_date(mv["transaction_date"]),
        "material_id": refs.material(mv["material"]),
        "roll_id": {"id": mv["roll"], "roll_number": roll_number.rt_roll_number if roll_number else None},
        "vendor_id": refs.vendor(mv["vendor"], with_code=False),
        "weight": flt(mv["weight"]),
        "used_weight": flt(mv["used_weight"]) if mv["used_weight"] is not None else None,
        "description": mv["description"],
        "from_location": refs.location(mv["from_location"]),
        "to_location": refs.location(mv["to_location"]),
        "roll_weight_after": flt(mv["roll_weight_after"]) if mv["roll_weight_after"] is not None else None,
        "issued_to": mv["issued_to"] or None,
        "remarks": mv["remarks"] or None,
        "remark_code": mv["remark_code"] or None,
        "photo_paths": mv["photos"],
        "photo_urls": [],
        "buyer": mv["buyer"] or None,
        "savio_bill_no": mv["savio_bill_no"] or None,
        "vehicle_no": mv["vehicle_no"] or None,
        "rate_per_roll": mv["rate_per_roll"],
        "created_by": refs.user(extra.owner),
        "client_id": mv["client_id"] or None,
        "createdAt": iso(mv["creation"]),
        "updatedAt": iso(mv["modified"]),
    }
    optional = {"vendor_id", "issued_to", "remarks", "remark_code", "buyer", "savio_bill_no", "vehicle_no",
                "client_id"}
    return without_prices({k: v for k, v in out.items() if v is not None or k not in optional})


def _papers(b, refs: _Refs) -> list:
    """Node kept the vendor's copy of each picked paper; a roll here keeps one paper's codes,
    and the vendor's copy supplies the rest (common, found in)."""
    if not (b.rt_rt_code or b.rt_delta_code or b.rt_paper_code):
        return []
    own = next((p for p in refs.vendor_papers(b.rt_vendor) if
                (p.rt_code or "") == (b.rt_rt_code or "") and (p.delta_code or "") == (b.rt_delta_code or "")
                and (p.paper_code or "") == (b.rt_paper_code or "")), None)
    paper = {"royal_touche_code": b.rt_rt_code, "delta_code": b.rt_delta_code,
             "is_common": True if own and cint(own.is_common) else None,
             "supplier_code_number": b.rt_paper_code, "found_in": own.found_in if own else None}
    return [{k: v for k, v in paper.items() if v}]


def _remark(name: str, refs: _Refs) -> dict:
    r = refs.get("RT Remark", name, ["remark_code", "label", "disabled"])
    if not r:
        return {"id": name, "remark_code": None, "label": None, "status": None}
    return {"id": name, "remark_code": r.remark_code, "label": r.label,
            "status": "inactive" if cint(r.disabled) else "active"}


def iso(value) -> str | None:
    """An instant as Node sent it: UTC, milliseconds, "Z"."""
    if not value:
        return None
    return as_ist(get_datetime(value)).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z")


def iso_date(value) -> str | None:
    """A business date. A picked day (stored as that day's midnight) reads back as Node stored a
    plain day — that day's UTC midnight — so it shows as the same day; an instant as an instant."""
    if not value:
        return None
    value = get_datetime(value)
    if value.time() == time(0, 0):
        return f"{value.date().isoformat()}T00:00:00.000Z"
    return iso(value)


def _num(value) -> str:
    value = flt(value)
    return str(int(value)) if value == int(value) else f"{value:g}"


# ---- the page ----

def _page(q, sort, order, page, page_size, offset) -> dict:
    """materialRolls.service.ts list: live rolls, `q` over the label's codes, sorted by roll
    number or date received (default newest received first)."""
    if sort and sort not in SORT_KEYS:
        raise RTValidation(f"sort: Invalid enum value. Expected 'roll_number' | 'date', received '{sort}'")
    if order and order not in ("asc", "desc"):
        raise RTValidation(f"order: Invalid enum value. Expected 'asc' | 'desc', received '{order}'")
    where = ["b.rt_deleted = 0", "ifnull(b.rt_status, '') != ''"]
    values = {}
    q = (q or "").strip()
    if q:
        values["q"] = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append("(" + " or ".join(f"b.{f} like %(q)s" for f in (
            "rt_roll_number", "rt_rt_code", "rt_delta_code", "rt_paper_code", "rt_barcode")) + ")")
    direction = "asc" if order == "asc" else "desc"
    if sort == "roll_number":
        order_by = f"b.rt_roll_number {direction}, b.creation asc, b.name asc"
    elif sort == "date":
        order_by = f"received {direction}, b.creation asc, b.name asc"
    else:
        order_by = "received desc, b.creation desc, b.name desc"
    condition = " and ".join(where)
    names = frappe.db.sql(
        f"select b.name, {RECEIVED} as received from `tabBatch` b where {condition}"
        f" order by {order_by} limit %(limit)s offset %(offset)s",
        {**values, "limit": page_size, "offset": offset}, pluck="name")
    total = frappe.db.sql(f"select count(*) from `tabBatch` b where {condition}", values)[0][0]
    refs = _Refs()
    return page_of([roll_response(n, refs) for n in names], total, page, page_size)


# ---- what Node's validators checked before the service ran ----

def _check_create(body: dict) -> None:
    """createRollSchema, with zodMessage's wording: the field's own message where the schema had
    one, else "field: Required"; at most three listed, then "(and N more)"."""
    issues = []

    def required(field, message=None):
        if body.get(field) is None:
            issues.append(message or f"{field}: Required")
            return False
        return True

    if required("roll_number") and not str(body["roll_number"]).strip():
        issues.append("Roll number is required")
    if "papers" in body and body["papers"] is not None:
        issues.extend(_paper_issues(body["papers"]))
    if body.get("barcode") is not None and not str(body["barcode"]).strip():
        issues.append("barcode: String must contain at least 1 character(s)")
    for field in ("material_id", "vendor_id"):
        if required(field) and not str(body[field]).strip():
            issues.append(f"{field}: Must be a valid id")
    if body.get("lot_id") is not None and not str(body["lot_id"]).strip():
        issues.append("lot_id: Must be a valid id")
    for field, label in (("weight", "Weight"), ("gsm", "GSM"), ("width", "Width")):
        if required(field, f"{label} is required"):
            issues.extend(_positive(body[field], field, label))
    if required("location") and not str(body["location"]).strip():
        issues.append("location: Must be a valid id")
    if required("date", "Date is required"):
        try:
            as_system(body["date"])
        except (TypeError, ValueError):
            issues.append("date: Invalid input")
    client_id = body.get("client_id")
    if client_id is not None and not _is_uuid(client_id):
        issues.append("client_id must be a UUID")
    for node, _, _ in PHOTO_FIELDS:
        if body.get(node) is not None and not isinstance(body[node], str):
            issues.append(f"{node}: Expected string, received {type(body[node]).__name__}")
    _raise(issues)


def _check_papers(papers) -> None:
    _raise(_paper_issues(papers))


def _paper_issues(papers) -> list:
    if not isinstance(papers, (tuple, type([]))):
        return ["papers: Expected array, received " + type(papers).__name__]
    if not papers:
        return ["papers: Pick at least one paper"]
    if len(papers) > MAX_PAPERS:
        return [f"papers: Array must contain at most {MAX_PAPERS} element(s)"]
    return []


def _positive(value, field, label) -> list:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        try:
            value = float(value)
        except (TypeError, ValueError):
            return [f"{field}: Expected number, received {type(value).__name__}"]
    return [] if value > 0 else [f"{label} must be greater than 0"]


def _raise(issues: list) -> None:
    if not issues:
        return
    listed = []
    for issue in issues:
        if issue not in listed:
            listed.append(issue)
        if len(listed) == 3:
            break
    remaining = len(issues) - len(listed)
    raise RTValidation(", ".join(listed) + (f" (and {remaining} more)" if remaining > 0 else ""))


def _is_uuid(value) -> bool:
    import uuid

    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def _paper_codes(body: dict) -> dict:
    """The picked paper's codes for rolls.register_roll / update_roll, which resolve them against
    the vendor's own list (RT code first, else Delta code), as Node's resolvePapers did. A roll
    here carries one paper, so picking two different papers is refused."""
    picked = body.get("papers") or []
    if isinstance(picked, str):
        picked = frappe.parse_json(picked)
    distinct = {}
    for p in picked:
        rt, delta = (p.get("royal_touche_code") or "").strip(), (p.get("delta_code") or "").strip()
        if not rt and not delta:
            raise RTValidation("A paper needs at least one of its two codes")
        distinct.setdefault(f"RT:{rt.upper()}" if rt else f"D:{delta.upper()}", (rt, delta))
    if len(distinct) > 1:
        raise RTValidation("A roll is booked against one paper — pick only one")
    if distinct:
        rt, delta = next(iter(distinct.values()))
        return {"rt_code": rt or None, "delta_code": None if rt else delta}
    if body.get("royal_touche_code"):
        return {"rt_code": body["royal_touche_code"], "delta_code": None}
    return {}
