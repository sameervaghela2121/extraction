# Acceptance test cases — index

**245 test cases** built from [the acceptance criteria](../2026-11-04-inventory-acceptance.md).
Each case has an ID, status, the criterion it covers, starting state, numbered steps and exact
expected values (roll status/kg/godown, history rows, ERPNext document, report figures, exact
refusal messages). Automated tests will carry the same IDs.

| Section | Cases | What it covers |
|---|---|---|
| [01 Core movements](01-core-movements.md) | 76 | Registration, remarks, outward, return, return to vendor, sale, consume, physical count, state-transition matrix |
| [02 New features](02-new-features.md) | 52 | Partial return to vendor, partial sale, store loss at outward, minimum stock per design, alerts page, godown move |
| [03 Dates, reports, sync](03-dates-reports-sync.md) | 53 | Day-by-day timelines (gaps, month end, India year end), date rules, offline/late sync, two tablets, every report and CSV |
| [04 Opening stock, portal, roles](04-opening-portal-roles.md) | 64 | Stock-take load and validation, portal corrections, delete, master data, who sees and does what |

**Status:** ✅ 161 work today · 🆕 76 to build · 🔶 8 need a value from the team.
**Arithmetic:** all 109 rows in the 26 day-by-day tables balance
(opening + received − consumed − returned − sold ± adjusted − store loss = closing).

## How to review

1. Read the cases for your area; for each one ask "is this what should happen?".
2. Mark anything wrong, missing or surprising (a comment next to the case ID is enough).
3. Answer the open questions at the end of sections 02, 03 and 04 (55 in total).
4. Read the "Bugs found" list below — each needs a yes "fix it" / no "that's fine".

## Coverage

Every acceptance criterion has at least one case.

| Criterion | Cases | | Criterion | Cases | | Criterion | Cases |
|---|---|---|---|---|---|---|---|
| AC-01 Enter a roll | 33 | | T-1 Long gap | 1 | | OS-1 Counts match sheet | 3 |
| AC-02 Remarks | 10 | | T-2 Month end | 3 | | OS-2 Ledger / Savio | 2 |
| AC-03 Different dates | 36 | | T-3 Same-day mix | 3 | | OS-3 Opening not Received | 5 |
| AC-04 Return to vendor | 12 | | T-4 Backdated | 8 | | OS-4 Scan-to-confirm | 1 |
| AC-05 Sale | 19 | | T-5 Offline overnight | 9 | | OS-5 Old roll lifecycle | 5 |
| AC-06 Godown move | 13 | | T-6 Late sync | 4 | | OS-6 No false store loss | 1 |
| AC-07a Return from floor | 10 | | E-1 Same scan twice | 8 | | OS-7 No half-loaded rows | 8 |
| AC-07b Partial return to vendor | 14 | | E-2 Two tablets | 7 | | OS-8 Re-run adds nothing | 2 |
| AC-08a Sell the leftover | 4 | | E-3 Correct unmoved roll | 14 | | I-1 Ledger = roll | 56 |
| AC-08b Partial sale | 12 | | E-4 Correct moved roll | 7 | | I-2 Daily balance | 64 |
| AC-09 Store loss | 12 | | E-5 Physical count | 13 | | I-3 Never negative | 7 |
| AC-10 Minimum stock | 15 | | E-6 Delete roll | 8 | | I-4 Finished = 0 kg | 25 |
| | | | E-7 Midnight boundary | 2 | | I-5 Week = sum of days | 13 |
| | | | E-8 Roles | 15 | | I-6 Reports agree | 38 |

## Bugs found while writing the cases (today's code)

Each has a `Note:` on its case. Ordered by how much they could hurt the stock figures.

**Stock and reports can go wrong**
1. **Dates are only half-checked.** Registration accepts any date, past or future
   (TC-IN-015/016). Physical counts and inward top-ups can be backdated by weeks
   (TC-ADJ-007, TC-DATE-011). Movements can be dated before the roll arrived or before its last
   movement: a sale dated yesterday on a roll received today gives yesterday **Closing −1000**
   (TC-DATE-010); a return dated before its outward reports consumption before the roll went
   out (TC-RET-011, TC-SYNC-005).
2. **Finished rolls can come back to life.** A physical count or an inward top-up on a
   Consumed, Returned-to-vendor or Sold roll puts kg back on it, sometimes in the hidden
   "Unassigned" godown. The portal refuses this; the tablet sync path doesn't
   (TC-STATE-003/004).
3. **No limit on how old an offline entry can be.** A tablet offline for 8 days (or with a slow
   clock) still posts and rewrites old reports (TC-DATE-006).
4. **Rolls can end up "In stock" on the production floor**: return when the home godown was
   retired meanwhile, registration with no godown, a portal location edit to Running Godown,
   and opening-stock floor rolls (no outward to return to) (TC-RET-009/010, TC-IN-018,
   TC-MOVE-006, TC-OS-019, TC-MST-004).
5. **Year-end crossing depends on ERPNext's background job** creating the next fiscal year; if
   it isn't running, every movement on 1 April fails (TC-TL-011).
6. **Consume on a finished roll** quietly adds a "Consumed" history row (TC-CON-003).

**Information gets lost or shows wrongly**
7. **Remarks:** codes and notes entered at registration are dropped (TC-IN-019); a movement's
   remark code isn't checked against the list (TC-RM-004); the daily roll report shows only
   the day's last note and today's roll remarks on past days (TC-RM-001/002); its "Roll note"
   column is always blank (TC-RPT-014).
8. **Savio bill no and vehicle no** are not on the ERPNext Delivery Note (TC-SELL-001).
9. **History text** "Corrected by 50 kg" doesn't say up or down (TC-ADJ-002); a physical count
   to 0 shows under Adjusted, not Consumed (TC-RPT-006); an inward top-up shows as Received
   (TC-STATE-002).
10. **Barcode clashes:** a roll's barcode can equal another roll's roll number, and a scan then
    always finds the first (core section intro); the barcode generator doesn't check existing
    roll barcodes, so stock-take labels could repeat an old label (TC-OS-016).
11. **"Last movement recorded at"** in the daily roll report is when the server received it,
    not when the operator saved it (TC-TL-004/005).

**Access**
12. **Operators are blocked from the portal only on screen** — the server still accepts an
    operator's login for roll edit/delete and master data (TC-ROLE-001). Who may delete a roll
    with history is an open question.
13. **Admin's portal menu shows only User management**; reports are refused to admin
    (TC-ROLE-003). Should admin see Rolls, Masters, Reports and Alerts?

**Smaller**
14. One failed entry in a sync holds back that roll's later entries (TC-SYNC-006).
15. Portal hint "no new movement" on a moved roll's current weight is wrong — an Adjusted row
    is written (TC-COR-006).
16. Reports have no Store loss column yet (TC-RPT-021) — part of the AC-09 build.

## Decisions the team should make first

These change many cases at once; the full lists are at the end of sections 02, 03 and 04.

- **Consumption day:** on the return day (today, as in Node) or the outward day? (TC-TL-009)
- **Backdating:** keep "today or yesterday" for every movement, registration and physical
  count — and refuse anything dated before the roll's last movement? (bugs 1, 3)
- **Partial return / sale:** kg of the piece going out or of what's left; weighed with a scale
  photo; price per kg or per piece; bill no and vehicle no mandatory?
- **Store loss:** tolerance (1 kg or 1 %?), loss = whole difference or only above tolerance,
  stock drops at once or after supervisor approval, how a mistyped weight is undone.
- **Minimum stock:** kg or roll count; per vendor's paper or per RT/Delta code across vendors;
  floor rolls excluded.
- **Opening stock:** a sample stock-take sheet; rolls found during the scan pass that aren't on
  the sheet; how a 2–3 day load shows in the Opening figure; rate per roll for old rolls.
- **Roles:** who may delete a roll with history; what admin sees on the portal.
