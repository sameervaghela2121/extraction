"""The consumption report: stock in, used and out over a period of India-time days, by
material or by design. Port of backend/src/services/consumptionReport.service.ts.

    Opening + Received - Consumed - Returned to vendor - Sold +/- Adjusted = Closing

and Closing includes what is out on the floor at the period's end (out_at_close).

Inputs are the same dicts as daily_status (see its docstring). This report reads, per ledger
row: name, roll, movement_type, transaction_date, creation, roll_weight_after, issued_to,
from_location, deleted, remarks (the detail's note), and optionally `material` (the
movement's own material; defaults to the roll's). Per roll: material, material_code
(defaults to material), material_name, vendor, vendor_name, rt_code, delta_code,
roll_number, barcode, lot_document_type, lot_document_no, deleted.

A design is a paper's RT and Delta codes together, upper-cased and trimmed: either can be
missing, and the pair is what tells a Delta-only paper from an RT-only one.
"""

import math

from royal_touche.report_logic.csv_out import to_csv
from royal_touche.report_logic.daily_status import (
    as_day,
    instant,
    ist_date,
    ist_day_range,
    live_rows,
    locale_key,
    status_after,
    write_order,
)

GROUPS = ("material", "design")

FIGURES = ("opening", "received", "consumed", "returned_to_vendor", "sold", "adjusted", "closing", "out_at_close")

FIGURE_COLUMNS = (
    ("Opening (kg)", "opening"),
    ("Received (kg)", "received"),
    ("Consumed (kg)", "consumed"),
    ("Returned to vendor (kg)", "returned_to_vendor"),
    ("Sold (kg)", "sold"),
    ("Adjusted (kg)", "adjusted"),
    ("Closing (kg)", "closing"),
    ("Out on floor at close (kg)", "out_at_close"),
)

# The columns naming a row, and which of them carries the word Total on the last line.
NAME_COLUMNS = {
    "material": ((("Material code", "material_code"), ("Material", "material")), "material"),
    "design": (
        (("RT code", "rt_code"), ("Delta code", "delta_code"), ("Vendor", "vendor"), ("Material", "material")),
        "rt_code",
    ),
}

DETAIL_COLUMNS = (
    ("Date", "date"),
    ("Roll number", "roll_number"),
    ("Barcode", "barcode"),
    ("Material code", "material_code"),
    ("Material", "material"),
    ("RT code", "rt_code"),
    ("Delta code", "delta_code"),
    ("Consumed (kg)", "used"),
    ("Left on roll (kg)", "left_on_roll"),
    ("Lot type", "lot_type"),
    ("Challan / invoice no", "document_no"),
    ("Used at", "used_at"),
    ("Issued to", "issued_to"),
    ("Note", "note"),
)


def _empty():
    return {field: 0 for field in FIGURES}


def kg(value: float) -> float:
    """Weights are decimals, and summing them drifts: 0.1 + 0.2 must not print
    0.30000000000000004. Rounds half up, as JavaScript's Math.round does."""
    return math.floor(value * 1000 + 0.5) / 1000


def design_key(roll: dict) -> str:
    """A roll's design, by its paper. Codes are compared without regard to case or stray
    spaces, as they were typed in by hand."""

    def code(value):
        return (value or "").strip().upper()

    return f"{code(roll.get('rt_code'))}|{code(roll.get('delta_code'))}"


def _material_of(row, roll):
    return row.get("material") or roll.get("material")


def _walk(ledger, rolls, from_day, to_day, group="material"):
    """Walks every movement of every live roll in the order they were written, because each
    row's figures were worked out in that order. What a row changed is the difference from
    the row before it; the row's own date then decides which period that change belongs to.
    So a movement entered late, after a later-dated one on the same roll, still lands on its
    own day and every period's figures add up. A removed roll is left out, and so are rows
    whose roll no longer exists."""
    if group not in GROUPS:
        raise ValueError(f"group must be one of {GROUPS}")
    start = ist_day_range(from_day)[0]
    end = ist_day_range(to_day)[1]

    by_roll: dict[str, list[dict]] = {}
    for row in sorted(live_rows(ledger, rolls), key=write_order):
        by_roll.setdefault(row["roll"], []).append(row)
    # Rolls in the order they were registered (their first row), as Node reads them by id.
    order = sorted(by_roll, key=lambda name: (write_order(by_roll[name][0]), name))

    figures: dict[str, dict] = {}
    members: dict[str, dict] = {}
    consumed: list[dict] = []

    def bucket(key):
        return figures.setdefault(key, _empty())

    for name in order:
        roll = rolls[name]
        issued_to = None
        weight = 0
        weight_at_close = 0
        status_at_close = None
        key_at_close = None
        for row in by_roll[name]:
            after = row.get("roll_weight_after")
            after = weight if after is None else after
            change = after - weight
            weight = after
            if row["movement_type"] == "OUT":
                issued_to = row.get("issued_to")
            when = instant(row["transaction_date"])
            if when >= end:
                continue

            weight_at_close += change
            status_at_close = status_after(row, status_at_close)
            key_at_close = _material_of(row, roll) if group == "material" else design_key(roll)
            material = bucket(key_at_close)
            if group == "design":
                member = members.setdefault(
                    key_at_close,
                    {"rt_code": roll.get("rt_code"), "delta_code": roll.get("delta_code"), "vendors": {}, "materials": {}},
                )
                if roll.get("vendor"):
                    member["vendors"][roll["vendor"]] = roll.get("vendor_name")
                member["materials"][_material_of(row, roll)] = None
            material["closing"] += change
            if when < start:
                material["opening"] += change
                continue
            kind = row["movement_type"]
            if kind == "IN":
                material["received"] += change
            elif kind in ("RETURN", "CONSUME"):
                material["consumed"] -= change
                if change != 0:
                    consumed.append({"row": row, "used": -change, "issued_to": issued_to})
            elif kind == "RETURN_TO_VENDOR":
                material["returned_to_vendor"] -= change
            elif kind == "SELL":
                material["sold"] -= change
            else:
                # ADJUSTMENT, and any correction carried on another row. An OUT changes nothing.
                material["adjusted"] += change
        if key_at_close is not None and status_at_close == "ISSUED":
            bucket(key_at_close)["out_at_close"] += weight_at_close
    return figures, consumed, members


def _materials(rolls):
    """Material id -> (code, name), read off the rolls."""
    found = {}
    for roll in rolls.values():
        if roll.get("material") and roll["material"] not in found:
            found[roll["material"]] = (roll.get("material_code") or roll["material"], roll.get("material_name") or "")
    return found


def _listed(names):
    return ", ".join(sorted(name for name in names if name))


def summary(ledger, rolls, from_day, to_day, group="material") -> dict:
    """One row per material or design that had stock or a movement in the period, and their
    total. Materials read alphabetically; designs, of which there are many, busiest first."""
    from_day, to_day = as_day(from_day), as_day(to_day)
    figures, _, members = _walk(ledger, rolls, from_day, to_day, group)
    materials = _materials(rolls)

    out = []
    for key, values in figures.items():
        rounded = {field: kg(values[field]) for field in FIGURES}
        if group == "material":
            code, name = materials.get(key, ("", ""))
            out.append({"material_code": code, "material": name, **rounded})
            continue
        member = members.get(key)
        out.append(
            {
                "material_code": "",
                "material": _listed(materials.get(m, ("", ""))[1] for m in member["materials"]) if member else "",
                "rt_code": (member["rt_code"] or "") if member else "",
                "delta_code": (member["delta_code"] or "") if member else "",
                "vendor": _listed(member["vendors"].values()) if member else "",
                **rounded,
            }
        )
    out = [row for row in out if any(row[field] != 0 for field in FIGURES)]
    if group == "material":
        out.sort(key=lambda row: locale_key(row["material"]))
    else:
        out.sort(key=lambda row: (-row["consumed"], locale_key(row["rt_code"], numeric=True)))

    totals = _empty()
    for row in out:
        for field in FIGURES:
            totals[field] = kg(totals[field] + row[field])
    return {"from": from_day.isoformat(), "to": to_day.isoformat(), "group": group, "rows": out, "totals": totals}


def summary_csv(ledger, rolls, from_day, to_day, group="material") -> str:
    result = summary(ledger, rolls, from_day, to_day, group)
    columns, total = NAME_COLUMNS[group]
    lines = [[row[f] for _, f in columns] + [row[f] for _, f in FIGURE_COLUMNS] for row in result["rows"]]
    lines.append(["Total" if f == total else "" for _, f in columns] + [result["totals"][f] for _, f in FIGURE_COLUMNS])
    return to_csv([label for label, _ in (*columns, *FIGURE_COLUMNS)], lines)


def detail(ledger, rolls, from_day, to_day, locations=None) -> list[dict]:
    """The proof behind the summary's Consumed column: one line per movement that used
    weight. `locations` (id -> name) names where the roll was used."""
    locations = locations or {}
    _, consumed, _ = _walk(ledger, rolls, as_day(from_day), as_day(to_day))
    materials = _materials(rolls)
    out = []
    for entry in consumed:
        row = entry["row"]
        roll = rolls[row["roll"]]
        code, name = materials.get(_material_of(row, roll), ("", ""))
        lot_type = roll.get("lot_document_type")
        has_lot = bool(lot_type or roll.get("lot_document_no"))
        after = row.get("roll_weight_after")
        out.append(
            {
                # India's day, however the instant is stored.
                "date": ist_date(row["transaction_date"]),
                "roll_number": roll.get("roll_number") or "",
                "barcode": roll.get("barcode"),
                "material_code": code,
                "material": name,
                "rt_code": roll.get("rt_code") or None,
                "delta_code": roll.get("delta_code") or None,
                "used": kg(entry["used"]),
                "left_on_roll": 0 if after is None else after,
                "lot_type": ("Invoice" if (lot_type or "").lower() == "invoice" else "Challan") if has_lot else None,
                "document_no": roll.get("lot_document_no") if has_lot else None,
                "used_at": locations.get(row["from_location"]) if row.get("from_location") else None,
                "issued_to": entry["issued_to"],
                "note": row.get("remarks"),
            }
        )
    out.sort(key=lambda r: (r["date"], locale_key(r["roll_number"], numeric=True)))
    return out


def detail_csv(ledger, rolls, from_day, to_day, locations=None) -> str:
    rows = detail(ledger, rolls, from_day, to_day, locations)
    return to_csv([label for label, _ in DETAIL_COLUMNS], [[row[f] for _, f in DETAIL_COLUMNS] for row in rows])
