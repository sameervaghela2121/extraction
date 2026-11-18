"""The admin portal's lots, barcode label runs and app download link.

Same answers, messages and role rules as the old server: backend/src/services/lots.service.ts,
barcodeBatches.service.ts, controllers/app.controller.ts, their validators and routes."""

import re
from datetime import timezone

import frappe
from frappe.utils import cint, get_fullname, getdate

from royal_touche import lots
from royal_touche.api._access import rt_role
from royal_touche.barcodes import code_width, date_digits, next_number
from royal_touche.dates import as_ist
from royal_touche.errors import RTConflict, RTNotFound, RTValidation
from royal_touche.portal import GODOWN_WRITE, page_of, page_window, require_roles

LOTS_PAGE_SIZE, LOTS_MAX_PAGE_SIZE = 50, 200  # lots.validators.ts: the roll form's picker asks for 200
MAX_SEARCH_RESULTS = 50
MAX_BATCH_LABELS = 500
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Runs saved without a size read back at their kind's own long-standing default.
DEFAULT_SIZE = {"barcode": (100, 50), "qr": (40, 40)}


def _iso(value) -> str | None:
    if not value:
        return None
    return as_ist(value).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _require_app_user() -> None:
    """requireAuth: anyone signed in to the app, which is anyone holding an app role."""
    if not rt_role():
        raise frappe.PermissionError("You do not have permission to perform this action")


def _like(text: str) -> str:
    return "%" + re.sub(r"([\\%_])", r"\\\1", text) + "%"


def _paged(items, total, page, page_size) -> dict:
    # Node's paginated(): an empty list reads as page 1 of 1.
    return page_of(items, total, page, page_size)


# ---------------------------------------------------------------- lots


def _lot(row) -> dict:
    return {
        "id": row.name,
        "document_type": row.document_type,
        "document_no": row.document_no,
        "document_photo_path": row.document_photo or None,
        # Node signed a URL here; ERPNext's private files need the login token instead, so the
        # portal fetches document_photo_path itself (fileObjectUrl) and fills this in.
        "document_photo_url": None,
        "client_id": row.client_id or None,
        "created_by": row.owner,
        "createdAt": _iso(row.creation),
        "updatedAt": _iso(row.modified),
    }


LOT_FIELDS = ["name", "document_type", "document_no", "document_photo", "client_id", "owner", "creation", "modified"]


def _lot_by_name(name: str) -> dict:
    row = frappe.db.get_value("Roll Lot", name, LOT_FIELDS, as_dict=True)
    if not row:
        raise RTNotFound("Lot not found")
    return _lot(row)


@frappe.whitelist(methods=["GET"])
def list_lots(q: str | None = None, page=None, pageSize=None) -> dict:
    _require_app_user()
    page = max(1, cint(page) or 1)
    page_size = min(LOTS_MAX_PAGE_SIZE, max(1, cint(pageSize) or LOTS_PAGE_SIZE))
    filters = {}
    q = (q or "").strip()
    if q:
        filters["document_no"] = ["like", _like(q)]
    rows = frappe.get_all("Roll Lot", filters=filters, fields=LOT_FIELDS, order_by="creation desc, name desc",
                          offset=(page - 1) * page_size, limit=page_size)
    return _paged([_lot(r) for r in rows], frappe.db.count("Roll Lot", filters), page, page_size)


@frappe.whitelist(methods=["GET"])
def get_lot(id: str) -> dict:
    _require_app_user()
    return _lot_by_name(id)


@frappe.whitelist(methods=["POST"])
def create_lot(document_type=None, document_no=None, document_photo_path=None, client_id=None) -> dict:
    require_roles(*GODOWN_WRITE)
    if document_no is not None and not isinstance(document_no, str):
        raise RTValidation("Challan or invoice number is required")
    created = lots.create_lot({
        "document_type": document_type if isinstance(document_type, str) else None,
        "document_no": document_no,
        "document_photo": document_photo_path or None,
        "client_id": client_id or None,
    })
    return _lot_by_name(created["name"])


# ---------------------------------------------------------------- barcode label runs

BATCH_FIELDS = ["name", "prefix", "date", "from_number", "to_number", "kind", "owner", "creation"]


def _batch_fields() -> list[str]:
    return BATCH_FIELDS + ["width_mm", "height_mm"]


def _batch(row, names: dict) -> dict:
    kind = row.kind or "barcode"
    width, height = DEFAULT_SIZE.get(kind, DEFAULT_SIZE["barcode"])
    if row.get("width_mm"):
        width = _number(row.width_mm)
    if row.get("height_mm"):
        height = _number(row.height_mm)
    if row.owner not in names:
        names[row.owner] = get_fullname(row.owner) if row.owner else "—"
    return {
        "id": row.name,
        "prefix": row.prefix,
        "date": str(row.date) if row.date else "",
        "from_number": row.from_number,
        "to_number": row.to_number,
        "kind": kind,
        "widthMm": width,
        "heightMm": height,
        "count": row.to_number - row.from_number + 1,
        "createdBy": names[row.owner] or "—",
        "createdAt": _iso(row.creation),
    }


def _number(value):
    value = float(value)
    return int(value) if value.is_integer() else value


@frappe.whitelist(methods=["GET"])
def list_barcode_batches(page=None, pageSize=None) -> dict:
    _require_app_user()
    page, page_size, offset = page_window(page, pageSize)
    filters = {"deleted": 0}
    rows = frappe.get_all("Barcode Batch", filters=filters, fields=_batch_fields(),
                          order_by="creation desc, name desc", offset=offset, limit=page_size)
    names = {}
    return _paged([_batch(r, names) for r in rows], frappe.db.count("Barcode Batch", filters), page, page_size)


@frappe.whitelist(methods=["GET"])
def barcode_next_number(prefix: str | None = None, date: str | None = None) -> dict:
    """Where the next run for this prefix and date starts. Deleted runs count: their labels
    were printed and may be on rolls, so their numbers stay spent."""
    _require_app_user()
    prefix, date = (prefix or "").strip(), (date or "").strip()
    if len(prefix) > 12:
        raise RTValidation("prefix: String must contain at most 12 character(s)")
    if date and not DATE.match(date):
        raise RTValidation("Date must be YYYY-MM-DD")
    if not prefix or not date:
        return {"next": 1}  # every saved run has both, so none matches
    try:
        getdate(date)
    except Exception:
        raise RTValidation("Date must be YYYY-MM-DD") from None
    return {"next": next_number(prefix, date)}


def _head(batch) -> str:
    return f"{batch.prefix}{date_digits(batch.date)}".upper()


def _codes_containing(batches, text: str, limit: int = MAX_SEARCH_RESULTS):
    """Every code, across every run, that contains this text — one number at a time within each
    run's range, since a fragment can straddle the prefix, the date and the number."""
    needle = text.strip().upper()
    hits = []
    if not needle:
        return hits
    for batch in batches:
        head, width = _head(batch), code_width(batch.from_number, batch.to_number)
        for n in range(batch.from_number, batch.to_number + 1):
            code = f"{head}{str(n).zfill(width)}"
            if needle in code:
                hits.append((batch, n, code))
                if len(hits) >= limit:
                    return hits
    return hits


def _resolve_exact(batches, raw: str):
    code = (raw or "").strip().upper()
    if not code:
        return None
    for batch in batches:
        head = _head(batch)
        if not code.startswith(head):
            continue
        rest = code[len(head):]
        if len(rest) != code_width(batch.from_number, batch.to_number) or not rest.isdigit():
            continue
        n = int(rest)
        if batch.from_number <= n <= batch.to_number:
            return batch, n
    return None


@frappe.whitelist(methods=["GET"])
def search_barcodes(q: str | None = None) -> dict:
    """Any part of a code, a roll number, or an RT / Delta paper code → single stickers, never a
    whole run."""
    _require_app_user()
    query = (q or "").strip()
    if not query:
        return {"items": []}
    batches = frappe.get_all("Barcode Batch", filters={"deleted": 0}, fields=_batch_fields(),
                             order_by="creation asc, name asc")
    names, seen, items = {}, set(), []

    def add(resolved, code, roll=None):
        if not resolved:
            return
        key = (resolved[0].name, resolved[1])
        if key in seen:
            return
        seen.add(key)
        item = {"code": code, "batch": _batch(resolved[0], names)}
        if roll:
            item["roll"] = roll
        items.append(item)

    for batch, n, code in _codes_containing(batches, query):
        add((batch, n), code)

    pattern = _like(query)
    rolls = frappe.db.sql(
        """select rt_roll_number, rt_rt_code, rt_delta_code, rt_barcode from `tabBatch`
        where ifnull(rt_deleted, 0) = 0 and ifnull(rt_barcode, '') != ''
          and (rt_roll_number like %(p)s or rt_rt_code like %(p)s or rt_delta_code like %(p)s)
        order by creation asc, name asc limit %(limit)s""",
        {"p": pattern, "limit": MAX_SEARCH_RESULTS}, as_dict=True,
    )
    for roll in rolls:
        found = {"roll_number": roll.rt_roll_number}
        if roll.rt_rt_code:
            found["royal_touche_code"] = roll.rt_rt_code
        if roll.rt_delta_code:
            found["delta_code"] = roll.rt_delta_code
        add(_resolve_exact(batches, roll.rt_barcode), roll.rt_barcode.upper(), found)
    return {"items": items}


def _int_field(body: dict, field: str) -> int:
    value = body.get(field)
    if value is None:
        raise RTValidation(f"{field}: Required")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RTValidation(f"{field}: Expected number, received {type(value).__name__}")
    if isinstance(value, float) and not value.is_integer():
        raise RTValidation(f"{field}: Expected integer, received float")
    if value < 0:
        raise RTValidation(f"{field}: Number must be greater than or equal to 0")
    return int(value)


def _size_field(body: dict, field: str, default: int):
    value = body.get(field)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RTValidation(f"{field}: Expected number, received {type(value).__name__}")
    if value <= 0:
        raise RTValidation(f"{field}: Number must be greater than 0")
    if value > 500:
        raise RTValidation(f"{field}: Number must be less than or equal to 500")
    return _number(value)


def _checked_run(body: dict) -> dict:
    """createBarcodeBatchSchema, in its order and with its messages."""
    prefix = body.get("prefix")
    if not isinstance(prefix, str) or not prefix.strip():
        raise RTValidation("Enter the letters the code starts with")
    prefix = prefix.strip()
    if len(prefix) > 12:
        raise RTValidation("prefix: String must contain at most 12 character(s)")
    date = body.get("date")
    if not isinstance(date, str) or not date.strip():
        raise RTValidation("Pick a date")
    date = date.strip()
    if not DATE.match(date):
        raise RTValidation("Pick a date (YYYY-MM-DD)")
    try:
        getdate(date)
    except Exception:
        raise RTValidation("Pick a date (YYYY-MM-DD)") from None
    from_number, to_number = _int_field(body, "from_number"), _int_field(body, "to_number")
    kind = body.get("kind")
    if kind is None:
        kind = "barcode"
    if kind not in ("barcode", "qr"):
        raise RTValidation(f"kind: Invalid enum value. Expected 'barcode' | 'qr', received '{kind}'")
    width, height = _size_field(body, "widthMm", 100), _size_field(body, "heightMm", 50)
    if to_number < from_number:
        raise RTValidation("The end number is lower than the start number")
    count = to_number - from_number + 1
    if count > MAX_BATCH_LABELS:
        raise RTValidation(f"That's {count} labels — {MAX_BATCH_LABELS} at a time is the limit")
    return {"prefix": prefix.upper(), "date": date, "from_number": from_number, "to_number": to_number,
            "kind": kind, "width": width, "height": height}


@frappe.whitelist(methods=["POST"])
def create_barcode_batch(prefix=None, date=None, from_number=None, to_number=None, kind=None, widthMm=None,
                         heightMm=None) -> dict:
    require_roles(*GODOWN_WRITE)
    run = _checked_run({"prefix": prefix, "date": date, "from_number": from_number, "to_number": to_number,
                        "kind": kind, "widthMm": widthMm, "heightMm": heightMm})
    same = {k: run[k] for k in ("prefix", "date", "from_number", "to_number")}
    # A locking read: two clicks landing together wait for each other here, and the second
    # then sees the first's run. Kind doesn't matter — the physical numbers are what's spent.
    if frappe.db.get_value("Barcode Batch", same, "name", for_update=True):
        raise RTConflict("That exact run has already been saved")
    doc = {"doctype": "Barcode Batch", **same, "kind": run["kind"],
           "width_mm": run["width"], "height_mm": run["height"]}
    try:
        name = frappe.get_doc(doc).insert(ignore_permissions=True).name
    except frappe.UniqueValidationError:
        # The unique run index (barcode_batch.on_doctype_update): a save that raced this one won.
        frappe.clear_last_message()  # ERPNext's own "... must be unique"
        raise RTConflict("That exact run has already been saved") from None
    row = frappe.db.get_value("Barcode Batch", name, _batch_fields(), as_dict=True)
    return _batch(row, {})


@frappe.whitelist(methods=["POST", "DELETE"])
def remove_barcode_batch(id: str) -> dict:
    """Soft: the run leaves the list, its numbers stay spent (the labels may be on rolls)."""
    require_roles(*GODOWN_WRITE)
    deleted = frappe.db.get_value("Barcode Batch", id, "deleted", for_update=True) if id else None
    if deleted is None:
        raise RTNotFound("Barcode batch not found")
    if not cint(deleted):
        frappe.db.set_value("Barcode Batch", id, "deleted", 1)
    return {"id": id}


# ---------------------------------------------------------------- app download


@frappe.whitelist(methods=["GET"])
def apk_url() -> dict:
    """Where the current Android build downloads from (site config rt_apk_url)."""
    _require_app_user()
    url = frappe.conf.get("rt_apk_url")
    if not url:
        raise RTNotFound("No app build has been uploaded yet")
    return {"url": url}
