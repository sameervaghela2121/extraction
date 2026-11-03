"""The report logic, without Frappe: the ports of consumptionReport.service.ts and
dailyRollReport.service.ts, checked rule by rule and against the seed month's own figures.

Run:
    cd erpnext/royal_touche
    /home/trt-074/frappe-bench/env/bin/python -m unittest royal_touche.tests.test_report_logic -v

The seed scenarios (tests/fixtures/*.json, from `npm run seed:export`) are replayed here in
plain Python the way stock.service.ts applyToRoll records each movement, so the ledger fed to
the reports is the one the Node services would have written.
"""

import json
import random
import re
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from royal_touche.report_logic import consumption, daily_status
from royal_touche.report_logic.csv_out import BOM, csv_cell

UTC = timezone.utc
IST = timezone(timedelta(hours=5, minutes=30))
FIXTURES = Path(__file__).parent / "fixtures"
REPO = Path(__file__).resolve().parents[4]
FIELDS = ["opening", "received", "consumed", "returned_to_vendor", "sold", "adjusted", "closing", "out_at_close"]

NODE_COLUMNS = [
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
]


def ist(text: str) -> datetime:
    """'2026-10-05 09:00' as an India-time instant."""
    return datetime.fromisoformat(text).replace(tzinfo=IST)


def d(text: str) -> date:
    return date.fromisoformat(text)


# ---- Hand-built ledgers ------------------------------------------------------------------


class Book:
    """A small ledger written in order: each row's creation is the next minute after the last,
    unless given. Rolls are added with sensible defaults."""

    def __init__(self):
        self.ledger: list[dict] = []
        self.rolls: dict[str, dict] = {}
        self.clock = datetime(2026, 9, 1, tzinfo=UTC)
        self.seq = 0

    def roll(self, name, **fields):
        roll = {
            "name": name,
            "roll_number": name.upper(),
            "barcode": f"BC-{name.upper()}",
            "material": "MAT-A",
            "material_code": "MAT-A",
            "material_name": "Alpha",
            "vendor": "V1",
            "vendor_code": "V001",
            "vendor_name": "Vendor One",
            "paper_code": "P1",
            "rt_code": "RT1",
            "delta_code": "D1",
            "gsm": 60,
            "width": 900,
            "weight": 100,
            "unit": "kg",
            "received_date": date(2026, 10, 1),
            "lot_document_type": "challan",
            "lot_document_no": "CH-1",
            "location": "loc-1",
            "remarks": None,
            "remark_code": None,
            "remark_codes": [],
            "deleted": False,
        }
        roll.update(fields)
        self.rolls[name] = roll
        return roll

    def move(self, roll, movement_type, when, rwa=None, weight=0, creation=None, **fields):
        self.seq += 1
        self.clock = creation or (self.clock + timedelta(minutes=1))
        row = {
            "name": f"mv-{self.seq:04d}",
            "roll": roll,
            "movement_type": movement_type,
            "transaction_date": when if isinstance(when, datetime) else ist(when),
            "creation": self.clock,
            "weight": weight,
            "used_weight": None,
            "roll_weight_after": rwa,
            "issued_to": None,
            "from_location": None,
            "to_location": None,
            "remarks": None,
            "remark_code": None,
            "recorded_by": "Supervisor",
            "deleted": False,
        }
        row.update(fields)
        self.ledger.append(row)
        return row


def figures(row):
    return [row[f] for f in FIELDS]


def reconciles(row):
    worked = row["opening"] + row["received"] - row["consumed"] - row["returned_to_vendor"] - row["sold"] + row["adjusted"]
    return abs(worked - row["closing"]) < 0.001


# ---- Replaying a seed fixture as the Node services would have written it -----------------

LOCATION_NAMES = {"SEED-LOC-1": "Seed Godown", "SEED-LOC-2": "Seed Floor"}


def replay(path: Path):
    """The fixture's plan through applyToRoll's rules: one ledger row per registration and
    movement, in the seed's write order (seq), each stamped at the time it was saved."""
    data = json.loads(path.read_text())
    lots = {lot["key"]: lot for lot in data["lots"]}
    vendors = {v["vendor_code"]: v for v in data["masters"]["vendors"]}
    remark_labels = {r["remark_code"]: r["label"] for r in data["masters"]["remarks"]}
    steps = [("roll", r) for r in data["rolls"]] + [("movement", m) for m in data["movements"]]
    steps.sort(key=lambda s: s[1]["seq"])

    ledger, rolls, state = [], {}, {}

    def write(roll, movement_type, step, **fields):
        row = {
            "name": f"mv-{step['seq']:05d}",
            "roll": roll,
            "movement_type": movement_type,
            "creation": datetime.fromisoformat(step["saved"]),
            "used_weight": None,
            "issued_to": None,
            "from_location": None,
            "to_location": None,
            "remarks": None,
            "remark_code": None,
            "recorded_by": "Seed Supervisor",
            "deleted": False,
        }
        row.update(fields)
        ledger.append(row)

    for kind, step in steps:
        if kind == "roll":
            name = f"roll-{step['key'].lower()}"
            lot = lots.get(step["lot"]) if step["lot"] else None
            vendor = vendors[step["vendor"]]
            rolls[name] = {
                "name": name,
                "roll_number": step["roll_number"],
                "barcode": step["barcode"],
                "material": step["material"],
                "material_code": step["material"],
                "material_name": step["material"],
                "vendor": step["vendor"],
                "vendor_code": step["vendor"],
                "vendor_name": vendor["name"],
                "paper_code": step["paper"]["paper_code"],
                "rt_code": step["paper"]["rt_code"],
                "delta_code": step["paper"]["delta_code"],
                "gsm": step["gsm"],
                "width": step["width"],
                "weight": step["weight"],
                "unit": step["unit"],
                "received_date": d(step["received"]),
                "lot_document_type": lot["document_type"] if lot else None,
                "lot_document_no": lot["document_no"] if lot else None,
                "location": step["location"],
                "remarks": None,
                "remark_code": None,
                "remark_codes": [],
                "deleted": False,
            }
            state[name] = {"remaining": step["weight"], "status": "IN_STOCK", "location": step["location"], "home": None}
            write(
                name,
                "IN",
                step,
                # Node stores the roll's date as midnight UTC, and dates its receipt row the same.
                transaction_date=datetime.fromisoformat(step["received"]).replace(tzinfo=UTC),
                weight=step["weight"],
                roll_weight_after=step["weight"],
                remarks=f"Roll {step['roll_number']} received",
            )
            continue

        name = f"roll-{step['roll'].lower()}"
        roll, s = rolls[name], state[name]
        when = datetime.fromisoformat(step["date"])
        if step["type"] == "DELETE":
            roll["deleted"] = True
            for row in ledger:
                if row["roll"] == name:
                    row["deleted"] = True
            continue
        if "roll_remark_codes" in step:
            roll["remark_codes"] = list(step["roll_remark_codes"])
        common = {"transaction_date": when, "remarks": step.get("remarks")}
        kind = step["type"]
        if kind == "OUT":
            s["home"], s["status"] = s["location"], "ISSUED"
            frm, s["location"] = s["location"], step["location"]
            write(name, kind, step, weight=s["remaining"], roll_weight_after=s["remaining"], issued_to=step["issued_to"],
                  from_location=frm, to_location=step["location"], **common)
        elif kind == "RETURN":
            back = step["returned_weight"]
            used = s["remaining"] - back
            frm = s["location"]
            s["remaining"] = back
            s["status"] = "CONSUMED" if back == 0 else "IN_STOCK"
            s["location"] = None if back == 0 else (s["home"] or s["location"])
            write(name, kind, step, weight=back, used_weight=used, roll_weight_after=back, from_location=frm,
                  to_location=None if back == 0 else s["home"], **common)
        elif kind in ("RETURN_TO_VENDOR", "SELL"):
            frm, gone = s["location"], s["remaining"]
            s.update(remaining=0, status="RETURNED_TO_VENDOR" if kind == "RETURN_TO_VENDOR" else "SOLD", location=None)
            write(name, kind, step, weight=gone, roll_weight_after=0, from_location=frm, **common)
        elif kind == "CONSUME":
            if s["status"] in ("CONSUMED", "RETURNED_TO_VENDOR", "SOLD"):
                write(name, kind, step, weight=0, used_weight=0, roll_weight_after=0, from_location=s["location"], **common)
            else:
                frm, used = s["location"], s["remaining"]
                s.update(remaining=0, status="CONSUMED", location=None)
                write(name, kind, step, weight=used, used_weight=used, roll_weight_after=0, from_location=frm, **common)
        elif kind == "ADJUSTMENT":
            target = step["new_weight"]
            delta = target - s["remaining"]
            s["remaining"] = target
            if target == 0:
                s.update(status="CONSUMED", location=None)
            write(name, kind, step, weight=abs(delta), roll_weight_after=target, **common)
        else:
            raise AssertionError(kind)
        roll["location"] = s["location"]

    # Callers may hand the rows over in any order.
    random.Random(7).shuffle(ledger)
    return data, ledger, rolls, remark_labels


def by_material(summary, code):
    for row in summary["rows"]:
        if row["material_code"] == code:
            return figures(row)
    return [0] * 8


# ---- The seed month ------------------------------------------------------------------------


class TestOctoberScenario(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.ledger, cls.rolls, cls.remark_labels = replay(FIXTURES / "october.json")
        cls.codes = [m["material_code"] for m in cls.data["masters"]["materials"]]

    def test_fixture_size(self):
        self.assertEqual(len(self.data["rolls"]), 15)
        self.assertEqual(len(self.data["movements"]), 31)

    def test_every_period_by_material(self):
        for period in self.data["expected"]["periods"]:
            got = consumption.summary(self.ledger, self.rolls, d(period["from"]), d(period["to"]), "material")
            sums = [0] * 8
            for code in self.codes:
                expected = [period["figures"].get(code, {}).get(f, 0) for f in FIELDS]
                sums = [a + b for a, b in zip(sums, expected)]
                self.assertEqual(by_material(got, code), expected, f"{period['label']}: {code}")
            self.assertEqual(figures(got["totals"]), sums, f"{period['label']}: totals")
            for row in got["rows"]:
                self.assertTrue(reconciles(row), f"{period['label']}: {row['material_code']}")

    def test_each_rolls_october(self):
        for key, expected in self.data["expected"]["by_roll"].items():
            name = f"roll-{key.lower()}"
            own = [row for row in self.ledger if row["roll"] == name]
            got = consumption.summary(own, self.rolls, d("2026-10-01"), d("2026-10-31"), "material")
            self.assertEqual(len(got["rows"]), 1, key)
            self.assertEqual(figures(got["rows"][0]), [expected[f] for f in FIELDS], key)
        # R14 is removed: no figures at all.
        own = [row for row in self.ledger if row["roll"] == "roll-r14"]
        self.assertEqual(consumption.summary(own, self.rolls, d("2026-10-01"), d("2026-10-31"))["rows"], [])

    def test_october_by_design(self):
        got = consumption.summary(self.ledger, self.rolls, d("2026-10-01"), d("2026-10-31"), "design")
        expected = self.data["expected"]["october_by_design"]
        self.assertEqual(len(got["rows"]), len(expected))
        for row in got["rows"]:
            key = f"{row['rt_code'].strip().upper()}|{row['delta_code'].strip().upper()}"
            self.assertEqual(figures(row), [expected[key][f] for f in FIELDS], key)
            self.assertTrue(row["vendor"] and row["material"], key)
            self.assertTrue(reconciles(row), key)
        consumed = [row["consumed"] for row in got["rows"]]
        self.assertEqual(consumed, sorted(consumed, reverse=True))
        by_mat = consumption.summary(self.ledger, self.rolls, d("2026-10-01"), d("2026-10-31"))
        self.assertEqual(got["totals"], by_mat["totals"])

    def test_october_detail(self):
        month = consumption.detail(self.ledger, self.rolls, d("2026-10-01"), d("2026-10-31"), LOCATION_NAMES)
        self.assertEqual(sum(row["used"] for row in month), 1480)
        self.assertNotIn("SEED-R14", [row["roll_number"] for row in month])
        day = consumption.detail(self.ledger, self.rolls, d("2026-10-08"), d("2026-10-08"), LOCATION_NAMES)
        self.assertEqual([(r["roll_number"], r["used"]) for r in day], [("SEED-R03", 150)])
        self.assertEqual(day[0]["issued_to"], "Line 1")
        self.assertEqual(day[0]["used_at"], "Seed Floor")
        self.assertEqual(day[0]["left_on_roll"], 450)

    def test_daily_checks(self):
        for check in self.data["expected"]["daily"]:
            rows = daily_status.rows(self.ledger, self.rolls, LOCATION_NAMES, d(check["date"]), self.remark_labels)
            row = next((r for r in rows if r["Roll number"] == f"SEED-{check['roll']}"), None)
            label = f"{check['date']} {check['roll']}"
            if check["expect"] is None:
                self.assertIsNone(row, label)
                continue
            self.assertIsNotNone(row, label)
            for column, value in check["expect"].items():
                actual = "" if row[column] is None else row[column]
                self.assertEqual(actual, value, f"{label}: {column}")
            self.assertEqual(daily_status.count(self.ledger, self.rolls, d(check["date"])), len(rows), label)


class TestSeptemberScenario(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.ledger, cls.rolls, cls.remark_labels = replay(FIXTURES / "september.json")
        cls.codes = [m["material_code"] for m in cls.data["masters"]["materials"]]

    def test_fixture_size(self):
        self.assertEqual(len(self.data["rolls"]), 200)
        self.assertEqual(len(self.data["movements"]), 353)

    def test_every_day_and_week_by_material(self):
        for period in self.data["expected"]["periods"]:
            got = consumption.summary(self.ledger, self.rolls, d(period["from"]), d(period["to"]))
            for code in self.codes:
                expected = [period["figures"][code][f] for f in FIELDS]
                self.assertEqual(by_material(got, code), expected, f"{period['label']}: {code}")
            for row in got["rows"]:
                self.assertTrue(reconciles(row), f"{period['label']}: {row['material_code']}")

    def test_by_design_adds_up(self):
        span = (d("2026-09-01"), d("2026-09-27"))
        by_design = consumption.summary(self.ledger, self.rolls, *span, "design")
        by_mat = consumption.summary(self.ledger, self.rolls, *span)
        self.assertEqual(by_design["totals"], by_mat["totals"])
        self.assertGreater(len(by_design["rows"]), 20)
        for row in by_design["rows"]:
            self.assertTrue(reconciles(row), f"{row['rt_code']}|{row['delta_code']}")
        keys = [f"{r['rt_code'].upper()}|{r['delta_code'].upper()}" for r in by_design["rows"]]
        self.assertEqual(len(keys), len(set(keys)), "one row per design, whatever the case")
        detail = consumption.detail(self.ledger, self.rolls, *span, LOCATION_NAMES)
        self.assertAlmostEqual(sum(r["used"] for r in detail), by_mat["totals"]["consumed"], places=3)

    def test_daily_status_every_day(self):
        for day, expected in self.data["expected"]["daily"].items():
            rows = daily_status.rows(self.ledger, self.rolls, LOCATION_NAMES, d(day), self.remark_labels)
            self.assertEqual(len(rows), len(expected), day)
            self.assertEqual(daily_status.count(self.ledger, self.rolls, d(day)), len(expected), day)
            for row in rows:
                state = expected[row["Roll number"][len("SEED-"):]]
                self.assertEqual(row["Final weight"], state["remaining"], f"{day} {row['Roll number']}")
                self.assertEqual(row["Final status"], state["status_label"], f"{day} {row['Roll number']}")
                self.assertEqual(row["Movements that day"], state["movements"], f"{day} {row['Roll number']}")


# ---- Consumption, rule by rule ---------------------------------------------------------------


class TestIstDays(unittest.TestCase):
    def test_day_range(self):
        start, end = daily_status.ist_day_range(date(2026, 10, 2))
        self.assertEqual(start, datetime(2026, 10, 1, 18, 30, tzinfo=UTC))
        self.assertEqual(end, datetime(2026, 10, 2, 18, 30, tzinfo=UTC))

    def test_utc_evening_belongs_to_the_next_ist_day(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", datetime(2026, 9, 30, 0, 0, tzinfo=UTC), rwa=100, weight=100)
        book.move("r1", "OUT", datetime(2026, 10, 1, 19, 0, tzinfo=UTC), rwa=100, weight=100)
        book.move("r1", "RETURN", datetime(2026, 10, 1, 19, 0, tzinfo=UTC), rwa=60, weight=60, used_weight=40)
        oct1 = consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-01"))
        oct2 = consumption.summary(book.ledger, book.rolls, d("2026-10-02"), d("2026-10-02"))
        self.assertEqual(oct1["rows"][0]["consumed"], 0)
        self.assertEqual(oct2["rows"][0]["consumed"], 40)
        self.assertEqual(oct2["rows"][0]["opening"], 100)
        self.assertEqual(daily_status.rows(book.ledger, book.rolls, {}, d("2026-10-01")), [])
        self.assertEqual(len(daily_status.rows(book.ledger, book.rolls, {}, d("2026-10-02"))), 1)
        detail = consumption.detail(book.ledger, book.rolls, d("2026-10-02"), d("2026-10-02"))
        self.assertEqual(detail[0]["date"], "2026-10-02")

    def test_last_instant_of_the_day_and_first_of_the_next(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", ist("2026-10-01 23:59:59"), rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", ist("2026-10-02 00:00"), rwa=90, weight=10)
        oct1 = consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-01"))["rows"][0]
        oct2 = consumption.summary(book.ledger, book.rolls, d("2026-10-02"), d("2026-10-02"))["rows"][0]
        self.assertEqual((oct1["received"], oct1["adjusted"], oct1["closing"]), (100, 0, 100))
        self.assertEqual((oct2["opening"], oct2["adjusted"], oct2["closing"]), (100, -10, 90))

    def test_naive_datetimes_are_refused(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", datetime(2026, 10, 1, 10, 0), rwa=100, weight=100)
        with self.assertRaises(ValueError):
            consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-01"))


class TestWriteOrder(unittest.TestCase):
    def test_a_late_entry_lands_on_its_own_day(self):
        # Written: IN (1 Oct), a count dated 3 Oct, then a return dated 2 Oct, entered late.
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "OUT", "2026-10-02 09:00", rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", "2026-10-03 09:00", rwa=80, weight=20)
        book.move("r1", "RETURN", "2026-10-02 18:00", rwa=50, weight=50, used_weight=30)
        random.Random(1).shuffle(book.ledger)
        oct2 = consumption.summary(book.ledger, book.rolls, d("2026-10-02"), d("2026-10-02"))["rows"][0]
        oct3 = consumption.summary(book.ledger, book.rolls, d("2026-10-03"), d("2026-10-03"))["rows"][0]
        # Each row's change is from the row written before it: the count took 20, the return 30.
        self.assertEqual((oct2["consumed"], oct2["closing"]), (30, 70))
        self.assertEqual((oct3["opening"], oct3["adjusted"], oct3["closing"]), (70, -20, 50))
        for row in (oct2, oct3):
            self.assertTrue(reconciles(row))

    def test_creation_ties_are_broken_by_name(self):
        book = Book()
        book.roll("r1")
        t = datetime(2026, 10, 1, 10, 0, tzinfo=UTC)
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100, creation=t)
        book.move("r1", "ADJUSTMENT", "2026-10-01 09:00", rwa=70, weight=30, creation=t)
        book.ledger[0]["name"], book.ledger[1]["name"] = "a", "b"
        book.ledger.reverse()
        row = consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-01"))["rows"][0]
        self.assertEqual((row["received"], row["adjusted"], row["closing"]), (100, -30, 70))

    def test_rows_after_the_period_still_move_the_running_weight(self):
        # A row dated after the period, written before one dated inside it.
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", "2026-10-09 09:00", rwa=90, weight=10)
        book.move("r1", "ADJUSTMENT", "2026-10-02 09:00", rwa=85, weight=5)
        row = consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-05"))["rows"][0]
        self.assertEqual((row["received"], row["adjusted"], row["closing"]), (100, -5, 95))

    def test_missing_weight_after_changes_nothing(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", "2026-10-02 08:00", rwa=None, weight=0)
        row = consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-02"))["rows"][0]
        self.assertEqual((row["adjusted"], row["closing"]), (0, 100))


class TestMovementEffects(unittest.TestCase):
    def period(self, book, frm="2026-10-01", to="2026-10-31"):
        rows = consumption.summary(book.ledger, book.rolls, d(frm), d(to))["rows"]
        return rows[0] if rows else None

    def test_in_is_received(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        self.assertEqual(figures(self.period(book)), [0, 100, 0, 0, 0, 0, 100, 0])

    def test_out_changes_nothing_but_is_out_at_close(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-09-01 08:00", rwa=100, weight=100)
        book.move("r1", "OUT", "2026-10-01 08:00", rwa=100, weight=100)
        self.assertEqual(figures(self.period(book)), [100, 0, 0, 0, 0, 0, 100, 100])

    def test_out_after_the_period_is_not_out_at_close(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "OUT", "2026-11-01 00:01", rwa=100, weight=100)
        self.assertEqual(self.period(book)["out_at_close"], 0)

    def test_return_is_consumed(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "OUT", "2026-10-02 08:00", rwa=100, weight=100)
        book.move("r1", "RETURN", "2026-10-02 18:00", rwa=35, weight=35, used_weight=65)
        self.assertEqual(figures(self.period(book)), [0, 100, 65, 0, 0, 0, 35, 0])

    def test_consume_is_consumed(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "OUT", "2026-10-02 08:00", rwa=100, weight=100)
        book.move("r1", "CONSUME", "2026-10-03 08:00", rwa=0, weight=100, used_weight=100)
        self.assertEqual(figures(self.period(book)), [0, 100, 100, 0, 0, 0, 0, 0])

    def test_return_to_vendor(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "RETURN_TO_VENDOR", "2026-10-03 08:00", rwa=0, weight=100)
        self.assertEqual(figures(self.period(book)), [0, 100, 0, 100, 0, 0, 0, 0])

    def test_sell(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "SELL", "2026-10-03 08:00", rwa=0, weight=100)
        self.assertEqual(figures(self.period(book)), [0, 100, 0, 0, 100, 0, 0, 0])

    def test_adjustment_both_ways(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", "2026-10-03 08:00", rwa=80, weight=20)
        book.move("r1", "ADJUSTMENT", "2026-10-04 08:00", rwa=90, weight=10)
        self.assertEqual(figures(self.period(book)), [0, 100, 0, 0, 0, -10, 90, 0])

    def test_weight_added_back_is_received(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "OUT", "2026-10-02 08:00", rwa=100, weight=100)
        book.move("r1", "RETURN", "2026-10-02 18:00", rwa=0, weight=0, used_weight=100)
        book.move("r1", "IN", "2026-10-03 08:00", rwa=20, weight=20)
        self.assertEqual(figures(self.period(book)), [0, 120, 100, 0, 0, 0, 20, 0])

    def test_opening_is_everything_before_the_period(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-09-01 08:00", rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", "2026-09-15 08:00", rwa=90, weight=10)
        book.move("r1", "SELL", "2026-10-03 08:00", rwa=0, weight=90)
        self.assertEqual(figures(self.period(book)), [90, 0, 0, 0, 90, 0, 0, 0])

    def test_removed_rolls_and_rows_are_left_out(self):
        book = Book()
        book.roll("r1")
        book.roll("r2", deleted=True)
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", "2026-10-02 08:00", rwa=50, weight=50, deleted=True)
        book.move("r2", "IN", "2026-10-01 08:00", rwa=500, weight=500)
        book.move("ghost", "IN", "2026-10-01 08:00", rwa=700, weight=700)
        self.assertEqual(figures(self.period(book)), [0, 100, 0, 0, 0, 0, 100, 0])

    def test_a_period_with_nothing_has_no_rows(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "SELL", "2026-10-01 09:00", rwa=0, weight=100)
        got = consumption.summary(book.ledger, book.rolls, d("2026-10-05"), d("2026-10-06"))
        self.assertEqual(got["rows"], [])
        self.assertEqual(figures(got["totals"]), [0] * 8)

    def test_decimals_do_not_drift(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=0.1, weight=0.1)
        book.move("r1", "IN", "2026-10-01 09:00", rwa=0.30000000000000004, weight=0.2)
        row = self.period(book)
        self.assertEqual(row["received"], 0.3)
        self.assertEqual(consumption.summary_csv(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31")).splitlines()[1].split(",")[3], "0.3")


class TestGrouping(unittest.TestCase):
    def book(self):
        book = Book()
        book.roll("r1", rt_code="rt9 ", delta_code="d1", vendor="V2", vendor_name="Zeta Mills")
        book.roll("r2", rt_code="RT9", delta_code=" D1", vendor="V1", vendor_name="Alpha Mills", material="MAT-B",
                  material_code="MAT-B", material_name="Beta")
        book.roll("r3", rt_code="", delta_code="D1")
        book.roll("r4", rt_code="RT24", delta_code="")
        book.roll("r5", rt_code="RT10", delta_code="")
        book.roll("r6", rt_code="RT10", delta_code="", material="MAT-0", material_code="MAT-0", material_name="aardvark")
        for name, used in (("r1", 10), ("r2", 15), ("r3", 40), ("r4", 0), ("r5", 0), ("r6", 0)):
            book.move(name, "IN", "2026-10-01 08:00", rwa=100, weight=100)
            if used:
                book.move(name, "OUT", "2026-10-02 08:00", rwa=100, weight=100)
                book.move(name, "RETURN", "2026-10-02 18:00", rwa=100 - used, weight=100 - used, used_weight=used)
        return book

    def test_design_is_rt_and_delta_upper_cased_busiest_first(self):
        book = self.book()
        got = consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31"), "design")
        keys = [(r["rt_code"], r["delta_code"]) for r in got["rows"]]
        # D1 alone (40) is busier than RT9|D1 (25); the idle ones by RT code, RT10 before RT24.
        self.assertEqual(keys, [("", "D1"), ("rt9 ", "d1"), ("RT10", ""), ("RT24", "")])
        rt9 = got["rows"][1]
        self.assertEqual(rt9["consumed"], 25)
        self.assertEqual(rt9["vendor"], "Alpha Mills, Zeta Mills")
        self.assertEqual(rt9["material"], "Alpha, Beta")
        self.assertEqual(rt9["material_code"], "")
        self.assertEqual(got["rows"][2]["material"], "Alpha, aardvark")
        self.assertEqual(got["group"], "design")
        self.assertEqual((got["from"], got["to"]), ("2026-10-01", "2026-10-31"))
        for row in got["rows"]:
            self.assertTrue(reconciles(row))
        self.assertEqual(got["totals"], consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31"))["totals"])

    def test_material_rows_are_alphabetical(self):
        book = self.book()
        got = consumption.summary(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31"))
        self.assertEqual([r["material"] for r in got["rows"]], ["aardvark", "Alpha", "Beta"])
        self.assertEqual(list(got["rows"][0].keys()), ["material_code", "material", *FIELDS])
        self.assertEqual(got["rows"][1]["material_code"], "MAT-A")

    def test_summary_csv(self):
        book = self.book()
        text = consumption.summary_csv(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31"), "design")
        self.assertTrue(text.startswith(BOM))
        lines = text[1:].split("\r\n")
        self.assertEqual(lines[0], "RT code,Delta code,Vendor,Material,Opening (kg),Received (kg),Consumed (kg),"
                                   "Returned to vendor (kg),Sold (kg),Adjusted (kg),Closing (kg),Out on floor at close (kg)")
        self.assertEqual(lines[2], 'rt9 ,d1,"Alpha Mills, Zeta Mills","Alpha, Beta",0,200,25,0,0,0,175,0')
        self.assertEqual(lines[-2], "Total,,,,0,600,65,0,0,0,535,0")
        self.assertEqual(lines[-1], "")
        text = consumption.summary_csv(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31"))
        self.assertEqual(text[1:].split("\r\n")[-2], ",Total,0,600,65,0,0,0,535,0")


class TestDetail(unittest.TestCase):
    def test_one_line_per_movement_that_used_weight(self):
        book = Book()
        book.roll("r1", roll_number="DP24", lot_document_type="invoice", lot_document_no="INV-9")
        book.roll("r2", roll_number="DP9", lot_document_type=None, lot_document_no=None, barcode=None)
        for name in ("r1", "r2"):
            book.move(name, "IN", "2026-10-01 08:00", rwa=100, weight=100)
            book.move(name, "OUT", "2026-10-02 08:00", rwa=100, weight=100, issued_to="Line 2",
                      from_location="loc-1", to_location="loc-2")
            book.move(name, "RETURN", "2026-10-02 18:00", rwa=60, weight=60, used_weight=40,
                      from_location="loc-2", to_location="loc-1", remarks="=cmd")
        book.move("r1", "OUT", "2026-10-03 08:00", rwa=60, weight=60, issued_to="Line 3", from_location="loc-1", to_location="loc-2")
        book.move("r1", "RETURN", "2026-10-03 18:00", rwa=60, weight=60, used_weight=0, from_location="loc-2", to_location="loc-1")
        book.move("r1", "OUT", "2026-10-04 08:00", rwa=60, weight=60, issued_to="Line 4", from_location="loc-1", to_location="loc-2")
        book.move("r1", "CONSUME", "2026-10-04 18:00", rwa=0, weight=60, used_weight=60, from_location="loc-2")
        locations = {"loc-1": "Godown", "loc-2": "Floor"}
        rows = consumption.detail(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31"), locations)
        self.assertEqual([(r["date"], r["roll_number"], r["used"]) for r in rows],
                         [("2026-10-02", "DP9", 40), ("2026-10-02", "DP24", 40), ("2026-10-04", "DP24", 60)])
        self.assertEqual(rows[0], {
            "date": "2026-10-02", "roll_number": "DP9", "barcode": None, "material_code": "MAT-A",
            "material": "Alpha", "rt_code": "RT1", "delta_code": "D1", "used": 40, "left_on_roll": 60,
            "lot_type": None, "document_no": None, "used_at": "Floor", "issued_to": "Line 2", "note": "=cmd",
        })
        self.assertEqual((rows[1]["lot_type"], rows[1]["document_no"]), ("Invoice", "INV-9"))
        self.assertEqual(rows[2]["issued_to"], "Line 4")
        text = consumption.detail_csv(book.ledger, book.rolls, d("2026-10-01"), d("2026-10-31"), locations)
        lines = text[1:].split("\r\n")
        self.assertEqual(lines[0], "Date,Roll number,Barcode,Material code,Material,RT code,Delta code,Consumed (kg),"
                                   "Left on roll (kg),Lot type,Challan / invoice no,Used at,Issued to,Note")
        self.assertEqual(lines[1], "2026-10-02,DP9,,MAT-A,Alpha,RT1,D1,40,60,,,Floor,Line 2,'=cmd")


# ---- CSV ------------------------------------------------------------------------------------


class TestCsv(unittest.TestCase):
    def test_formula_guard(self):
        for text in ("=SUM(A1)", "+91", "-5 kg", "@me", "\tx"):
            self.assertEqual(csv_cell(text), "'" + text)
        self.assertEqual(csv_cell("a=1"), "a=1")
        self.assertEqual(csv_cell("\rx"), "\"'\rx\"")
        self.assertEqual(csv_cell(-20), "-20")
        self.assertEqual(csv_cell(-20.5), "-20.5")
        self.assertEqual(csv_cell(None), "")
        self.assertEqual(csv_cell("plain"), "plain")

    def test_quoting(self):
        self.assertEqual(csv_cell('a,b'), '"a,b"')
        self.assertEqual(csv_cell('say "hi"'), '"say ""hi"""')
        self.assertEqual(csv_cell("two\nlines"), '"two\nlines"')
        self.assertEqual(csv_cell("=a,b"), "\"'=a,b\"")

    def test_numbers_print_as_javascript_does(self):
        self.assertEqual(csv_cell(100.0), "100")
        self.assertEqual(csv_cell(0.3), "0.3")
        self.assertEqual(csv_cell(-0.0), "0")
        self.assertEqual(csv_cell(7), "7")


# ---- Daily roll status ----------------------------------------------------------------------


class TestDailyStatus(unittest.TestCase):
    def test_thirty_columns_in_node_order(self):
        self.assertEqual(len(daily_status.REPORT_COLUMNS), 30)
        self.assertEqual(list(daily_status.REPORT_COLUMNS), NODE_COLUMNS)

    def test_columns_match_the_node_source(self):
        source = REPO / "backend/src/services/dailyRollReport.service.ts"
        if not source.exists():
            self.skipTest("Node source not here")
        block = re.search(r"export const REPORT_COLUMNS = \[(.*?)\] as const", source.read_text(), re.S).group(1)
        self.assertEqual(list(daily_status.REPORT_COLUMNS), re.findall(r'"([^"]+)"', block))

    def test_status_after(self):
        sa = daily_status.status_after
        self.assertEqual(sa({"movement_type": "OUT", "weight": 1, "roll_weight_after": 1}), "ISSUED")
        self.assertEqual(sa({"movement_type": "RETURN", "weight": 0, "roll_weight_after": 0}), "CONSUMED")
        self.assertEqual(sa({"movement_type": "RETURN", "weight": 5, "roll_weight_after": 5}), "IN_STOCK")
        self.assertEqual(sa({"movement_type": "RETURN_TO_VENDOR", "weight": 5, "roll_weight_after": 0}), "RETURNED_TO_VENDOR")
        self.assertEqual(sa({"movement_type": "SELL", "weight": 5, "roll_weight_after": 0}), "SOLD")
        consume0 = {"movement_type": "CONSUME", "weight": 0, "roll_weight_after": 0}
        self.assertEqual(sa(consume0, "SOLD"), "SOLD")
        self.assertEqual(sa(consume0, "RETURNED_TO_VENDOR"), "RETURNED_TO_VENDOR")
        self.assertEqual(sa(consume0, "ISSUED"), "CONSUMED")
        self.assertEqual(sa(consume0), "CONSUMED")
        adj = {"movement_type": "ADJUSTMENT", "weight": 5, "roll_weight_after": 5}
        self.assertEqual(sa(adj, "ISSUED"), "ISSUED")
        self.assertEqual(sa(adj), "IN_STOCK")
        self.assertEqual(sa({**adj, "roll_weight_after": 0}, "ISSUED"), "CONSUMED")
        self.assertEqual(sa({"movement_type": "IN", "weight": 5, "roll_weight_after": 5}, "ISSUED"), "ISSUED")
        self.assertEqual(sa({"movement_type": "IN", "weight": 5, "roll_weight_after": 5}, "SOLD"), "IN_STOCK")

    def test_location_after(self):
        la = daily_status.location_after
        self.assertIsNone(la({"movement_type": "CONSUME", "from_location": "a"}, None, "x"))
        self.assertEqual(la({"movement_type": "OUT", "from_location": "a", "to_location": "b"}, None, "x"), "b")
        self.assertEqual(la({"movement_type": "OUT", "from_location": "a", "to_location": None}, None, "x"), "a")
        self.assertIsNone(la({"movement_type": "RETURN", "roll_weight_after": 0, "to_location": "b"}, None, "x"))
        self.assertEqual(la({"movement_type": "RETURN", "roll_weight_after": 4, "from_location": "a", "to_location": None}, None, "x"), "a")
        self.assertEqual(la({"movement_type": "IN"}, {"from_location": "n"}, "x"), "n")
        self.assertIsNone(la({"movement_type": "IN"}, {"from_location": None}, "x"))
        self.assertEqual(la({"movement_type": "IN"}, None, "x"), "x")
        self.assertIsNone(la({"movement_type": "ADJUSTMENT", "roll_weight_after": 0}, None, "x"))
        self.assertEqual(la({"movement_type": "ADJUSTMENT", "roll_weight_after": 3}, None, "x"), "x")

    def book(self):
        book = Book()
        book.roll("r1", roll_number="DP24", remarks="+roll note", remark_code="COLOR-VAR",
                  remark_codes=["MISPRINT", "COLOR-VAR", "GONE"], received_date=date(2026, 10, 1),
                  lot_document_type="invoice", lot_document_no="INV-7")
        book.roll("r2", roll_number="DP9", paper_code=None, rt_code="", delta_code="D9", location="loc-1")
        book.move("r1", "IN", datetime(2026, 10, 1, tzinfo=UTC), rwa=100, weight=100,
                  remarks="Roll DP24 received", creation=ist("2026-10-01 08:00"))
        book.move("r1", "OUT", "2026-10-05 09:00", rwa=100, weight=100, issued_to="Line 1",
                  from_location="loc-1", to_location="loc-2", creation=ist("2026-10-05 09:01"))
        book.move("r1", "RETURN", "2026-10-05 17:00", rwa=70, weight=70, used_weight=30, from_location="loc-2",
                  to_location="loc-1", remark_code="DEFECT", remarks="edge torn, wet", creation=ist("2026-10-05 17:02"))
        book.move("r2", "IN", datetime(2026, 10, 5, tzinfo=UTC), rwa=50, weight=50,
                  remarks="Roll DP9 received", creation=ist("2026-10-05 07:00"))
        return book

    def test_a_roll_as_it_stood_after_its_last_movement_of_the_day(self):
        book = self.book()
        labels = {"COLOR-VAR": "Colour", "MISPRINT": "Misprint"}
        rows = daily_status.rows(book.ledger, book.rolls, {"loc-1": "Godown", "loc-2": "Floor"}, d("2026-10-05"), labels)
        self.assertEqual([r["Roll number"] for r in rows], ["DP9", "DP24"])
        dp24 = rows[1]
        self.assertEqual(list(dp24.keys()), NODE_COLUMNS)
        self.assertEqual(dp24, {
            "Report date": "2026-10-05",
            "Roll number": "DP24",
            "Barcode": "BC-R1",
            "Lot type": "Invoice",
            "Challan / invoice no": "INV-7",
            "Vendor code": "V001",
            "Vendor": "Vendor One",
            "Paper code": "P1",
            "RT code": "RT1",
            "Delta code": "D1",
            "Material code": "MAT-A",
            "Material": "Alpha",
            "GSM": 60,
            "Width (mm)": 900,
            "Received date": "2026-10-01",
            "Unit": "kg",
            "Weight on arrival": 100,
            "Final weight": 70,
            "Final status": "In stock",
            "Last movement": "Inward",
            "Weight moved": 70,
            "Weight used": 30,
            "Last location": "Godown",
            "Issued to": None,
            # Picked on the roll (in order, an unknown id dropped), its own code, the movement's
            # code printed as is when the master has no label; each once.
            "Remarks": "Misprint, Colour, DEFECT",
            "Movement note": "edge torn, wet",
            "Roll note": "+roll note",
            "Movements that day": 2,
            "Last movement recorded at": "2026-10-05 17:02",
            "Recorded by": "Supervisor",
        })
        dp9 = rows[0]
        # A registration: the server's own line is not a note, and the roll is where it is now.
        self.assertEqual((dp9["Last movement"], dp9["Movement note"], dp9["Last location"]), ("Received", None, "Godown"))
        self.assertEqual((dp9["Paper code"], dp9["RT code"], dp9["Delta code"]), ("", "", "D9"))
        self.assertEqual(daily_status.count(book.ledger, book.rolls, d("2026-10-05")), 2)

    def test_csv(self):
        book = self.book()
        text = daily_status.csv(book.ledger, book.rolls, {"loc-1": "Godown"}, d("2026-10-05"), {})
        self.assertTrue(text.startswith(BOM))
        lines = text[1:].split("\r\n")
        self.assertEqual(lines[0], ",".join(NODE_COLUMNS))
        self.assertEqual(len(lines), 4)
        self.assertIn(",'+roll note,", lines[2])
        self.assertIn(',"edge torn, wet",', lines[2])
        self.assertIn(",2026-10-05 17:02,Supervisor", lines[2])

    def test_status_and_location_read_the_whole_ledger(self):
        book = Book()
        book.roll("r1", location="loc-9")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "OUT", "2026-10-02 08:00", rwa=100, weight=100, from_location="loc-1", to_location="loc-2")
        # Weight added back while out: the roll stays out, at the floor the next row leaves from.
        book.move("r1", "IN", "2026-10-03 08:00", rwa=100, weight=0)
        book.move("r1", "RETURN", "2026-10-04 08:00", rwa=90, weight=90, used_weight=10, from_location="loc-3", to_location="loc-1")
        row = daily_status.rows(book.ledger, book.rolls, {"loc-3": "Floor 3"}, d("2026-10-03"))[0]
        self.assertEqual((row["Final status"], row["Last location"]), ("Out", "Floor 3"))
        # A zero-weight CONSUME on a sold roll keeps it sold.
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "SELL", "2026-10-02 08:00", rwa=0, weight=100)
        book.move("r1", "CONSUME", "2026-10-03 08:00", rwa=0, weight=0, used_weight=0)
        row = daily_status.rows(book.ledger, book.rolls, {}, d("2026-10-03"))[0]
        self.assertEqual((row["Final status"], row["Last movement"], row["Last location"]), ("Sold", "Consumed", None))

    def test_the_last_row_is_the_last_written_not_the_latest_dated(self):
        book = Book()
        book.roll("r1")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r1", "ADJUSTMENT", "2026-10-02 18:00", rwa=90, weight=10)
        book.move("r1", "ADJUSTMENT", "2026-10-02 09:00", rwa=95, weight=5)
        random.Random(3).shuffle(book.ledger)
        row = daily_status.rows(book.ledger, book.rolls, {}, d("2026-10-02"))[0]
        self.assertEqual((row["Final weight"], row["Movements that day"]), (95, 2))

    def test_removed_rolls_are_left_out(self):
        book = Book()
        book.roll("r1", deleted=True)
        book.roll("r2")
        book.move("r1", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r2", "IN", "2026-10-01 08:00", rwa=100, weight=100)
        book.move("r2", "ADJUSTMENT", "2026-10-01 09:00", rwa=90, weight=10, deleted=True)
        rows = daily_status.rows(book.ledger, book.rolls, {}, d("2026-10-01"))
        self.assertEqual([(r["Roll number"], r["Movements that day"]) for r in rows], [("R2", 1)])
        self.assertEqual(daily_status.count(book.ledger, book.rolls, d("2026-10-01")), 1)


if __name__ == "__main__":
    unittest.main()
