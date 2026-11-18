# Acceptance test cases — index

**263 test cases** aligned to [decisions.md](../decisions.md) (**D-01 … D-61**) and built from
[the acceptance criteria](../2026-11-04-inventory-acceptance.md).
Each case has an ID, status, the criterion it covers, starting state, numbered steps and exact
expected values (roll status/kg/godown, history rows, ERPNext document, report figures, exact
refusal messages). Automated tests will carry the same IDs.

| Section | Cases | What it covers |
|---|---|---|
| [01 Core movements](01-core-movements.md) | 80 | Registration (incl. paper-first D-60), remarks, outward, return, return to vendor, sale, consume, physical count, state-transition matrix |
| [02 New features](02-new-features.md) | 57 | Partial return to vendor, partial sale, store loss at outward, minimum stock per design, alerts page, godown move |
| [03 Dates, reports, sync](03-dates-reports-sync.md) | 56 | Day-by-day timelines, date rules, offline/late sync, two tablets, every report and CSV, FY alerts |
| [04 Opening stock, portal, roles](04-opening-portal-roles.md) | 70 | Stock-take load, portal corrections, delete, masters, **portal dashboard (D-61)**, roles |

**Status (primary mark per case):** ✅ **141** work today · 🆕 fix **36** agreed corrections not yet in code · 🆕 **86** to build.
(Was 245 → 257 for D-60 alignment, then **+6 TC-DASH-*** for the portal dashboard; no open 🔶.)

**Arithmetic:** day-by-day tables balance with
opening + old stock loaded + received − consumed − returned − sold ± adjusted − store loss = closing
(D-49).

## How to review

1. Read the cases for your area; for each one ask "is this what should happen?".
2. Mark anything wrong, missing or surprising (a comment next to the case ID is enough).
3. Treat [decisions.md](../decisions.md) as settled — do not re-open D-01 … D-60 here.
4. Read the "Agreed fixes" list below — each is a 🆕 fix case tied to a decision.

## Coverage

Every acceptance criterion has at least one case. Counts below include new paper-first and
partial/portal/FY cases added for D-09, D-10, D-14, D-19, D-21, D-60.

| Criterion | Cases | | Criterion | Cases | | Criterion | Cases |
|---|---|---|---|---|---|---|---|
| AC-01 Enter a roll | 37 | | T-1 Long gap | 1 | | OS-1 Counts match sheet | 3 |
| AC-02 Remarks | 10 | | T-2 Month end | 3 | | OS-2 Ledger / Savio | 2 |
| AC-03 Different dates | 36 | | T-3 Same-day mix | 3 | | OS-3 Opening not Received | 5 |
| AC-04 Return to vendor | 12 | | T-4 Backdated | 8 | | OS-4 Scan-to-confirm | 1 |
| AC-05 Sale | 19 | | T-5 Offline overnight | 9 | | OS-5 Old roll lifecycle | 5 |
| AC-06 Godown move | 13 | | T-6 Late sync | 4 | | OS-6 No false store loss | 1 |
| AC-07a Return from floor | 10 | | E-1 Same scan twice | 8 | | OS-7 No half-loaded rows | 8 |
| AC-07b Partial return to vendor | 16 | | E-2 Two tablets | 7 | | OS-8 Re-run adds nothing | 2 |
| AC-08a Sell the leftover | 4 | | E-3 Correct unmoved roll | 14 | | I-1 Ledger = roll | 56 |
| AC-08b Partial sale | 13 | | E-4 Correct moved roll | 7 | | I-2 Daily balance | 64 |
| AC-09 Store loss | 13 | | E-5 Physical count | 13 | | I-3 Never negative | 7 |
| AC-10 Minimum stock | 15 | | E-6 Delete roll | 8 | | I-4 Finished = 0 kg | 25 |
| Portal dashboard (D-61) | 6 | | E-7 Midnight boundary | 2 | | I-5 Week = sum of days | 13 |
| | | | E-8 Roles | 15 | | I-6 Reports agree | 38 |

## Agreed fixes (D-56 / D-57 and related)

Each has a `Note:` on its case and status **🆕 fix**. Ordered by how much they could hurt the stock figures.

**Stock and reports (D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-12, D-56)**
1. **Dates:** registration and counts today-or-yesterday only (TC-IN-015/016, TC-ADJ-007,
   TC-DATE-009/011). Movements dated before arrival or before the latest movement refused
   (TC-DATE-010, TC-SYNC-005, TC-RET-011). Offline entries older than **2 days** refused
   (TC-DATE-006).
2. **Finished rolls stay finished:** count / inward / consume on sold, consumed or returned
   rolls refused (TC-STATE-003/004, TC-CON-003).
3. **Godown required** at registration (TC-IN-018).
4. **Count shortfall** (including 0) → Store loss + alert; history "Counted N kg less/more";
   inward top-up under **Adjusted** (TC-ADJ-001/002/003, TC-RPT-006, TC-STATE-002).
5. **"Last movement recorded at"** = tablet save time (TC-TL-004/005).
6. **Roll note** filled; registration remarks kept (TC-RPT-014, TC-IN-019).
7. **Delete** refused if movements sit in a closed month (TC-RPT-017 / TC-DEL).
8. **Remark codes** on movements must come from the Remarks list (TC-RM-004).

**Information and access (D-18, D-42, D-52–D-55, D-57, D-59)**
9. **Return-to-vendor remark** optional (TC-RTV-001, TC-PRTV-*).
10. **Godown move** writes history "Moved to another godown" + stock transfer (TC-MOVE-001/002).
11. **Barcode / roll-number clash** refused; generator skips used numbers (TC-IN-024, TC-OS-016).
12. **Operators** blocked on the server for portal actions (TC-ROLE-001).
13. **Savio bill / vehicle** on ERPNext Delivery Note (TC-SELL-001).
14. **Rolls page hint** wording (TC-COR-006).
15. **Roles:** only super admin, supervisor, operator — no admin (TC-ROLE-*).

**Kept as written (D-01, D-58)**
- Consumption counted on the **return day** (TC-TL-009, TC-RPT-003).
- Sync **hold-back** when one entry for a roll fails (TC-SYNC-006).

## Next

1. Business re-reviews this catalog ([session-summary-2026-11-17.md](../session-summary-2026-11-17.md)).
2. Automate ✅ cases first (same IDs).
3. Failing tests for each 🆕 fix, then implement.
4. Build remaining 🆕 features.
