"""The reports on real ERPNext records: both seed months replayed through the business
actions, then every figure the seed checks — the same figures today's Node reports give."""

from datetime import date

from frappe.tests import IntegrationTestCase

from royal_touche import reports
from royal_touche.checks import ledger_mismatches
from royal_touche.report_logic import daily_status
from royal_touche.tests.replay_scenario import load
from royal_touche.tests.test_report_logic import FIELDS, FIXTURES, NODE_COLUMNS, by_material, figures, reconciles


def d(text: str) -> date:
    return date.fromisoformat(text)


class TestOctoberReports(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.scenario = load(FIXTURES / "october.json")
        cls.data = cls.scenario["data"]
        cls.codes = [m["material_code"] for m in cls.data["masters"]["materials"]]

    def test_ledger_agrees_after_the_replay(self):
        self.assertEqual(ledger_mismatches(list(self.scenario["rolls"].values())), [])

    def test_every_period_by_material(self):
        for period in self.data["expected"]["periods"]:
            got = reports.consumption_summary(d(period["from"]), d(period["to"]), "material")
            for code in self.codes:
                expected = [period["figures"].get(code, {}).get(f, 0) for f in FIELDS]
                self.assertEqual(by_material(got, code), expected, f"{period['label']}: {code}")
            for row in got["rows"]:
                self.assertTrue(reconciles(row), f"{period['label']}: {row['material_code']}")

    def test_each_rolls_october(self):
        ledger, rolls, _, _ = reports.load()
        from royal_touche.report_logic import consumption

        for key, expected in self.data["expected"]["by_roll"].items():
            name = self.scenario["rolls"][key]
            own = [row for row in ledger if row["roll"] == name]
            got = consumption.summary(own, rolls, d("2026-10-01"), d("2026-10-31"))
            if key == "R14":
                self.assertEqual(got["rows"], [], key)
                continue
            self.assertEqual(figures(got["rows"][0]), [expected[f] for f in FIELDS], key)

    def test_october_by_design(self):
        got = reports.consumption_summary(d("2026-10-01"), d("2026-10-31"), "design")
        expected = self.data["expected"]["october_by_design"]
        self.assertEqual(len(got["rows"]), len(expected))
        for row in got["rows"]:
            key = f"{row['rt_code'].strip().upper()}|{row['delta_code'].strip().upper()}"
            self.assertEqual(figures(row), [expected[key][f] for f in FIELDS], key)

    def test_october_detail(self):
        month = reports.consumption_detail(d("2026-10-01"), d("2026-10-31"))
        self.assertEqual(sum(row["used"] for row in month), 1480)
        self.assertNotIn("SEED-R14", [row["roll_number"] for row in month])
        day = reports.consumption_detail(d("2026-10-08"), d("2026-10-08"))
        self.assertEqual([(r["roll_number"], r["used"]) for r in day], [("SEED-R03", 150)])
        self.assertEqual((day[0]["issued_to"], day[0]["used_at"], day[0]["left_on_roll"]), ("Line 1", "Seed Floor", 450))

    def test_daily_checks(self):
        for check in self.data["expected"]["daily"]:
            rows = reports.daily_rows(d(check["date"]))
            row = next((r for r in rows if r["Roll number"] == f"SEED-{check['roll']}"), None)
            label = f"{check['date']} {check['roll']}"
            if check["expect"] is None:
                self.assertIsNone(row, label)
                continue
            self.assertIsNotNone(row, label)
            for column, value in check["expect"].items():
                self.assertEqual("" if row[column] is None else row[column], value, f"{label}: {column}")

    def test_script_reports_run(self):
        from royal_touche.royal_touche.report.rt_consumption.rt_consumption import execute as consumption_report
        from royal_touche.royal_touche.report.rt_daily_roll_status.rt_daily_roll_status import execute as daily_report

        columns, data = consumption_report({"from_date": "2026-10-01", "to_date": "2026-10-31", "group": "material"})
        self.assertIn("consumed", [c["fieldname"] for c in columns])
        self.assertEqual(sum(r["consumed"] for r in data if r.get("material_code")),
                         reports.consumption_summary(d("2026-10-01"), d("2026-10-31"))["totals"]["consumed"])
        columns, data = daily_report({"date": "2026-10-08"})
        self.assertEqual([c["label"] for c in columns], NODE_COLUMNS)
        self.assertEqual(len(data), daily_status.count(*reports.load()[:2], d("2026-10-08")))


class TestSeptemberReports(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.scenario = load(FIXTURES / "september.json")
        cls.data = cls.scenario["data"]
        cls.codes = [m["material_code"] for m in cls.data["masters"]["materials"]]

    def test_ledger_agrees_after_the_replay(self):
        self.assertEqual(ledger_mismatches(list(self.scenario["rolls"].values())), [])

    def test_every_day_and_week_by_material(self):
        for period in self.data["expected"]["periods"]:
            got = reports.consumption_summary(d(period["from"]), d(period["to"]))
            for code in self.codes:
                expected = [period["figures"][code][f] for f in FIELDS]
                self.assertEqual(by_material(got, code), expected, f"{period['label']}: {code}")

    def test_daily_status_every_day(self):
        for day, expected in self.data["expected"]["daily"].items():
            rows = reports.daily_rows(d(day))
            self.assertEqual(len(rows), len(expected), day)
            for row in rows:
                state = expected[row["Roll number"][len("SEED-"):]]
                self.assertEqual((row["Final weight"], row["Final status"], row["Movements that day"]),
                                 (state["remaining"], state["status_label"], state["movements"]), f"{day} {row['Roll number']}")
