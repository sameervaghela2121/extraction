"""The daily roll status report: one row per roll that moved on an India-time day, as it stood
after its last movement that day. Port of backend/src/services/dailyRollReport.service.ts.

Weight, status, location and the movement's own figures come from the ledger, so a later
movement cannot change an earlier day's report. Everything else (identity, lot, paper, vendor,
material, picked remarks) comes from the roll as it is now: none of those keep a history.

Inputs (plain dicts; the caller reads them out of ERPNext):

ledger: list of movement rows, any order, one per Roll Movement:
    name              str       tie-break for equal `creation`
    roll              str       the roll's name (key of `rolls`)
    movement_type     str       IN, OUT, RETURN, ADJUSTMENT, CONSUME, RETURN_TO_VENDOR, SELL
    transaction_date  datetime  timezone-aware; when the movement happened
    creation          datetime  timezone-aware; when it was written (the order that counts)
    weight            float     what the movement moved, always positive
    used_weight       float|None
    roll_weight_after float|None
    issued_to         str|None
    from_location     str|None  location id
    to_location       str|None  location id
    deleted           bool
  added to the contract for this report:
    remarks           str|None  the movement's free-text note ("Movement note")
    remark_code       str|None  remark picked on the movement ("Remarks")
    recorded_by       str|None  display name of who wrote it ("Recorded by")

rolls: dict roll name -> roll:
    name, roll_number, barcode, material, material_name, vendor, vendor_name, paper_code,
    rt_code, delta_code, gsm, width, weight (on arrival), lot_document_type ("invoice" or
    "challan"), lot_document_no, deleted (bool)
  added to the contract for this report:
    material_code     str|None  defaults to `material` (an Item's name is its code)
    vendor_code       str|None
    unit              str|None  default "kg"
    received_date     date, or aware datetime read as an India-time day
    location          str|None  the roll's location now: where a roll whose last row names
                                none is, when nothing has moved it since
    remarks           str|None  the roll's own note ("Roll note")
    remark_code       str|None  remark noted at registration
    remark_codes      list[str] remarks picked on the roll since, in order

locations: dict location id -> display name.
remark_labels: dict remark code -> label. A picked code (remark_codes) missing from it is
    left out, as Node drops a stale reference; a noted code (remark_code on the roll or the
    movement) missing from it prints as the code.
"""

import re
from datetime import date, datetime, timedelta, timezone

from royal_touche.report_logic.csv_out import to_csv

UTC = timezone.utc
# The business day is India's, whichever zone the server runs in.
IST = timezone(timedelta(hours=5, minutes=30))

STATUS_LABEL = {
    "IN_STOCK": "In stock",
    "ISSUED": "Out",
    "CONSUMED": "Consumed",
    "RETURNED_TO_VENDOR": "Returned to vendor",
    "SOLD": "Sold",
}

MOVEMENT_LABEL = {
    "IN": "Received",
    "OUT": "Outward",
    "RETURN": "Inward",
    "ADJUSTMENT": "Adjusted",
    "CONSUME": "Consumed",
    "RETURN_TO_VENDOR": "Returned to vendor",
    "SELL": "Sold",
}

# The report's columns, in the order they print.
REPORT_COLUMNS = (
    "Report date",
    "Roll number",
    "Barcode",
    "Lot type",
    "Challan / invoice no",
    "Vendor code",
    "Vendor",
    "Paper code",
    "RT code",
    "Delta code",
    "Material code",
    "Material",
    "GSM",
    "Width (mm)",
    "Received date",
    "Unit",
    "Weight on arrival",
    "Final weight",
    "Final status",
    "Last movement",
    "Weight moved",
    "Weight used",
    "Last location",
    "Issued to",
    "Remarks",
    "Movement note",
    "Roll note",
    "Movements that day",
    "Last movement recorded at",
    "Recorded by",
)

# The server's own line on a registration row says nothing the columns don't.
_REGISTRATION_NOTE = re.compile(r"Roll .* received")


# ---- Days, instants and ordering (shared with consumption) ----------------------------------


def as_day(value) -> date:
    """A date, or "YYYY-MM-DD"."""
    if isinstance(value, datetime):
        raise ValueError("Pass a date, not a datetime")
    return value if isinstance(value, date) else date.fromisoformat(value)


def instant(value: datetime) -> datetime:
    """A timezone-aware datetime, refused otherwise: a naive one could be any zone's."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"Datetime {value!r} has no time zone")
    return value


def ist_day_range(day) -> tuple[datetime, datetime]:
    """[start, end) of an India-time day, as UTC instants."""
    day = as_day(day)
    start = datetime(day.year, day.month, day.day, tzinfo=IST).astimezone(UTC)
    return start, start + timedelta(days=1)


def ist_date(value: datetime) -> str:
    return instant(value).astimezone(IST).date().isoformat()


def ist_datetime(value: datetime) -> str:
    return instant(value).astimezone(IST).strftime("%Y-%m-%d %H:%M")


def write_order(row: dict):
    """The order rows were written in: creation, then name."""
    return (instant(row["creation"]), row["name"])


_TOKENS = re.compile(r"\d+|\D")


def locale_key(text, numeric: bool = False):
    """A sort key close to JavaScript's localeCompare in English: case is ignored first,
    punctuation sorts before digits and digits before letters; with `numeric`, digit runs
    compare as numbers, so "DP9" comes before "DP24"."""
    text = "" if text is None else str(text)
    key = []
    for token in _TOKENS.findall(text) if numeric else text:
        if token.isdigit() and numeric:
            key.append((1, int(token), ""))
        elif token.isdigit():
            key.append((1, 0, token))
        elif token.isalpha():
            key.append((2, 0, token.casefold()))
        else:
            key.append((0, 0, token))
    # Ties, as ICU breaks them: lower case before upper.
    return (tuple(key), text.swapcase())


def live_rows(ledger, rolls):
    """The rows that count: not removed, on a roll that exists and is not removed."""
    return [
        row
        for row in ledger
        if not row.get("deleted") and row["roll"] in rolls and not rolls[row["roll"]].get("deleted")
    ]


# ---- A roll's standing after a movement ------------------------------------------------------


def status_after(row: dict, previous: str | None = None) -> str:
    """The roll's status once this movement had applied, given the one before it: the same
    transitions stock.service's applyToRoll makes. The row itself stores no status."""
    kind = row["movement_type"]
    if kind == "OUT":
        return "ISSUED"
    if kind == "RETURN":
        return "CONSUMED" if row.get("roll_weight_after") == 0 else "IN_STOCK"
    if kind == "RETURN_TO_VENDOR":
        return "RETURNED_TO_VENDOR"
    if kind == "SELL":
        return "SOLD"
    if kind == "CONSUME":
        # A CONSUME on a finished roll is a no-op with weight 0; it must not turn a returned
        # or sold roll into a consumed one.
        if row.get("weight") == 0 and previous and previous not in ("IN_STOCK", "ISSUED"):
            return previous
        return "CONSUMED"
    if kind == "ADJUSTMENT":
        return "CONSUMED" if row.get("roll_weight_after") == 0 else (previous or "IN_STOCK")
    if kind == "IN":
        # Registration, or weight added back: that reopens a finished roll, but a roll that
        # is out stays out.
        return "ISSUED" if previous == "ISSUED" else "IN_STOCK"
    raise ValueError(f"Unknown movement type {kind!r}")


def location_after(row: dict, next_row: dict | None, current: str | None) -> str | None:
    """The roll's location once this movement had applied. None: at no location (finished,
    or gone from the godown). Rows that state none leave the roll where it was, and the next
    movement's from_location says where that is; with no next movement, nothing has moved it
    since, so the roll's own location still holds."""

    def carried():
        return (next_row.get("from_location") or None) if next_row else (current or None)

    kind = row["movement_type"]
    if kind in ("CONSUME", "RETURN_TO_VENDOR", "SELL"):
        return None
    if kind == "OUT":
        # An OUT that names nowhere leaves the roll where it was.
        return row.get("to_location") or row.get("from_location") or None
    if kind == "RETURN":
        if row.get("roll_weight_after") == 0:
            return None
        return row.get("to_location") or row.get("from_location") or None
    if kind == "ADJUSTMENT":
        return None if row.get("roll_weight_after") == 0 else carried()
    if kind == "IN":
        return carried()
    raise ValueError(f"Unknown movement type {kind!r}")


# ---- The report ------------------------------------------------------------------------------


def _moved_on(ledger, rolls, day):
    """Each live roll's rows dated on the day, in write order."""
    start, end = ist_day_range(day)
    moved: dict[str, list[dict]] = {}
    for row in sorted(live_rows(ledger, rolls), key=write_order):
        if start <= instant(row["transaction_date"]) < end:
            moved.setdefault(row["roll"], []).append(row)
    return moved


def count(ledger, rolls, day) -> int:
    """How many rolls moved on the day: what the screen shows before anyone downloads."""
    return len(_moved_on(ledger, rolls, day))


def _joined(values):
    return ", ".join(v for v in values if v)


def _received(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return ist_date(value)
    return as_day(value).isoformat()


def rows(ledger, rolls, locations, day, remark_labels=None) -> list[dict]:
    """One row per roll that moved on the day, as it stood after its last movement that day,
    sorted by roll number the way mill numbers read ("DP9" before "DP24")."""
    day = as_day(day)
    locations = locations or {}
    remark_labels = remark_labels or {}
    moved = _moved_on(ledger, rolls, day)
    if not moved:
        return []

    ledgers: dict[str, list[dict]] = {}
    for row in sorted(live_rows(ledger, rolls), key=write_order):
        if row["roll"] in moved:
            ledgers.setdefault(row["roll"], []).append(row)

    out = []
    for name, day_rows in moved.items():
        roll = rolls[name]
        last = day_rows[-1]
        # Its standing after its last row, walking its whole ledger up to that row.
        ledger_of = ledgers[name]
        at = next(i for i, row in enumerate(ledger_of) if row is last)
        status = None
        for row in ledger_of[: at + 1]:
            status = status_after(row, status)
        next_row = ledger_of[at + 1] if at + 1 < len(ledger_of) else None
        location = location_after(last, next_row, roll.get("location"))

        # Picked on the roll, noted when it arrived, or picked on this movement: one remark
        # picked in two of those places reads once.
        labels = [remark_labels.get(code) for code in roll.get("remark_codes") or []]
        for code in (roll.get("remark_code"), last.get("remark_code")):
            if code:
                labels.append(remark_labels.get(code, code))
        remarks = list(dict.fromkeys(label for label in labels if label))

        note = last.get("remarks")
        if last["movement_type"] == "IN" and _REGISTRATION_NOTE.fullmatch(note or ""):
            note = None
        lot_type = roll.get("lot_document_type")
        has_lot = bool(lot_type or roll.get("lot_document_no"))

        out.append(
            {
                "Report date": day.isoformat(),
                "Roll number": roll.get("roll_number"),
                "Barcode": roll.get("barcode"),
                "Lot type": (("Invoice" if (lot_type or "").lower() == "invoice" else "Challan") if has_lot else None),
                "Challan / invoice no": roll.get("lot_document_no") if has_lot else None,
                "Vendor code": roll.get("vendor_code"),
                "Vendor": roll.get("vendor_name"),
                "Paper code": _joined([roll.get("paper_code")]),
                "RT code": _joined([roll.get("rt_code")]),
                "Delta code": _joined([roll.get("delta_code")]),
                "Material code": roll.get("material_code") or roll.get("material"),
                "Material": roll.get("material_name"),
                "GSM": roll.get("gsm"),
                "Width (mm)": roll.get("width"),
                "Received date": _received(roll.get("received_date")),
                "Unit": roll.get("unit") or "kg",
                "Weight on arrival": roll.get("weight"),
                "Final weight": last.get("roll_weight_after"),
                "Final status": STATUS_LABEL[status],
                "Last movement": MOVEMENT_LABEL[last["movement_type"]],
                "Weight moved": last.get("weight"),
                "Weight used": last.get("used_weight"),
                "Last location": locations.get(location) if location else None,
                "Issued to": last.get("issued_to"),
                "Remarks": ", ".join(remarks),
                "Movement note": note,
                "Roll note": roll.get("remarks"),
                "Movements that day": len(day_rows),
                "Last movement recorded at": ist_datetime(last["creation"]),
                "Recorded by": last.get("recorded_by"),
            }
        )
    return sorted(out, key=lambda r: locale_key(r["Roll number"], numeric=True))


def csv(ledger, rolls, locations, day, remark_labels=None) -> str:
    return to_csv(REPORT_COLUMNS, [[row[c] for c in REPORT_COLUMNS] for row in rows(ledger, rolls, locations, day, remark_labels)])
