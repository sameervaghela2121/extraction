# Test cases 04 — Opening stock, portal corrections, delete, masters, roles

Part of the acceptance test catalog for
[2026-11-04-inventory-acceptance.md](../2026-11-04-inventory-acceptance.md) (the authority).
Shared setup, notation (D1, D2…, IST) and invariants I-1…I-6 come from there. I-1…I-4 are
checked after every case even when not repeated under Expected.

Extra setup used below (on top of the shared setup):

- Second material **Coated paper** (for material corrections).
- ARIHANT's paper list: RT 501 / Delta 730N, RT 502. A second vendor **BALAJI** with RT 601 only.
- ERPNext warehouse names are the godown name + " - RT" (e.g. "Godown A - RT").
- Users: `op1` (Godown Operator), `sup1` (Godown Supervisor), `adm1` (RT Admin),
  `sa1` (RT Super Admin).

**Stock-take sheet S-A** (used by most TC-OS cases; load day = D1):

| Row | Roll no | Barcode | Vendor | RT / Delta | Material | GSM | Width | kg | Godown | Remark |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | OS-101 | OLD-0101 | ARIHANT | RT 501 | Base paper | 70 | 1000 | 400 | Godown A | |
| 3 | OS-102 | *(blank)* | ARIHANT | RT 502 | Base paper | 70 | 1000 | 600 | Godown A | |
| 4 | OS-103 | OLD-0103 | ARIHANT | RT 501 | Base paper | 70 | 1000 | 500 | Running Godown | |

S-A totals: Base paper 1500 kg (1000 in store, 500 out on the floor); RT 501 900; RT 502 600.

---

## Opening stock load

### TC-OS-001 Good rows load at their weighed kg, In stock or Out
- **Status:** 🆕 to build
- **Covers:** OS-1, OS-2 and I-1, I-3, I-6
- **Layer:** Auto
- **Given:** no rolls in the system; sheet S-A; today is D1.
- **Steps:**
  1. Admin runs the opening-stock load with S-A.
- **Expected:**
  - Load summary: 3 loaded, 0 rejected.
  - OS-101: **In stock**, arrival 400, current 400, Godown A, vendor ARIHANT, RT 501, GSM 70,
    width 1000, arrival date D1.
  - OS-102: In stock, arrival 600, current 600, Godown A, RT 502.
  - OS-103: **Out**, arrival 500, current 500, Running Godown.
  - All three in lot **OLD RECORD**, flagged **opening stock** (visible on the portal Rolls
    screen, the lot screen and the daily roll report / CSV lot column).
  - ERPNext: one submitted Purchase Receipt per roll from ARIHANT, posted D1, for 400 / 600 / 500
    kg into Godown A / Godown A / Running Godown; batch balances equal the rolls
    (`ledger_mismatches` empty).
  - History: 1 row per roll, "Opening stock 400 kg" (600, 500) 🔶 wording.

### TC-OS-002 Load-day report shows Opening, not Received; next day opening = closing
- **Status:** 🆕 to build
- **Covers:** OS-3 and I-2, I-5
- **Layer:** Auto
- **Given:** S-A loaded on D1 (TC-OS-001); no other movements D1–D3.
- **Steps:**
  1. Supervisor opens the consumption report for D1, D2, and the week D1–D7, by material and by design.
- **Expected:**

  | Report | Group | Opening | Received | Consumed | Closing | Out on floor |
  |---|---|---|---|---|---|---|
  | D1 | Base paper | 1500 | **0** | 0 | 1500 | 500 |
  | D1 | RT 501 | 900 | 0 | 0 | 900 | 500 |
  | D1 | RT 502 | 600 | 0 | 0 | 600 | 0 |
  | D2 | Base paper | 1500 | 0 | 0 | 1500 | 500 |
  | Week D1–D7 | Base paper | 1500 | 0 | 0 | 1500 | 500 |

  - Any report period ending before D1 shows nothing for these rolls.
  - Daily roll report D1 lists the 3 rolls (status In stock / In stock / Out), none as "Received".
- **Note:** today the reports count every IN row as Received; there is no opening-stock flag.

### TC-OS-003 Unknown vendor, material, godown or remark → row rejected, nothing posted for it
- **Status:** 🆕 to build
- **Covers:** OS-7 and load rules
- **Layer:** Auto
- **Given:** no rolls; sheet S-A plus these rows:

  | Row | Roll no | Problem |
  |---|---|---|
  | 5 | OS-105 | vendor code `ARIHANTT` (not a vendor) |
  | 6 | OS-106 | material `Base papr` |
  | 7 | OS-107 | godown `Godown C` |
  | 8 | OS-108 | remark code `NOSUCH` |
  | 9 | OS-109 | vendor code of an **inactive** vendor |

- **Steps:**
  1. Admin runs the load.
- **Expected:**
  - Error report lists rows 5–9, each with row number, roll no and the reason
    (🔶 wording, e.g. "Row 5 · OS-105 · vendor ARIHANTT not found", "Row 9 · OS-109 · BALAJI is
    inactive — pick a different vendor"). Nothing is guessed (no closest match picked).
  - No Batch, Purchase Receipt or history row exists for OS-105…OS-109.
  - Rows 2–4 load as in TC-OS-001; summary 3 loaded, 5 rejected.

### TC-OS-004 Design not in that vendor's paper list → row rejected
- **Status:** 🆕 to build
- **Covers:** OS-7 and load rules
- **Layer:** Auto
- **Given:** no rolls; sheet with row 2 `OS-201 · ARIHANT · RT 601` (RT 601 is BALAJI's only),
  row 3 `OS-202 · ARIHANT · Delta 999N`, row 4 `OS-203 · ARIHANT · Delta 730N` (valid).
- **Steps:**
  1. Admin runs the load.
- **Expected:**
  - Error report: "Row 2 · OS-201 · Paper RT 601 is not one of ARIHANT's papers",
    "Row 3 · OS-202 · Paper Delta 999N is not one of ARIHANT's papers" (the tablet's existing message).
  - OS-203 loads with RT 501 / Delta 730N (found by its Delta code). Nothing posted for OS-201/202.

### TC-OS-005 kg, GSM or width ≤ 0 or not a number → row rejected
- **Status:** 🆕 to build
- **Covers:** OS-7 and load rules
- **Layer:** Auto
- **Given:** sheet rows: `OS-301 kg 0`, `OS-302 kg -5`, `OS-303 kg "four hundred"`,
  `OS-304 GSM 0`, `OS-305 width -1000`.
- **Steps:**
  1. Admin runs the load.
- **Expected:** all five listed ("Weight must be greater than 0", "GSM must be greater than 0",
  "Width must be greater than 0", "kg must be a number" 🔶); nothing posted for any of them.

### TC-OS-006 Blank required column → row rejected
- **Status:** 🆕 to build
- **Covers:** OS-7 and load rules
- **Layer:** Auto
- **Given:** one row each with blank: roll no · vendor code · RT and Delta both blank · material ·
  GSM · width · kg · godown. A ninth row with only barcode and remark blank.
- **Steps:**
  1. Admin runs the load.
- **Expected:**
  - The 8 rows listed, each naming the blank column ("Row 4 · (no roll no) · Roll number is
    required", "Row 6 · OS-405 · RT or Delta code is required" 🔶 …); nothing posted for them.
  - The ninth row loads (barcode and remark are optional; a blank barcode gets a new label — TC-OS-016).
  - Fully empty rows at the end of the sheet are ignored, not reported.

### TC-OS-007 Duplicate roll no or barcode within the sheet → both rows rejected
- **Status:** 🆕 to build
- **Covers:** OS-7 and load rules
- **Layer:** Auto
- **Given:** sheet rows 2 `OS-501 / OLD-0501 / 400 kg`, 3 `os-501  / OLD-0599 / 450 kg`,
  4 `OS-502 / old-0501 / 300 kg`.
- **Steps:**
  1. Admin runs the load.
- **Expected:**
  - Rows 2 and 3 listed "duplicate roll no OS-501 (rows 2, 3)"; rows 2 and 4 listed
    "duplicate barcode OLD-0501 (rows 2, 4)" — compared after trimming and upper-casing.
  - None of the three loads (the system does not pick which one is real). 🔶

### TC-OS-008 Roll no or barcode already on an existing roll → row rejected
- **Status:** 🆕 to build
- **Covers:** OS-7 and load rules
- **Layer:** Auto
- **Given:** roll R1 (roll no R1, barcode BC-0001) registered on the tablet on D1 as a normal inward.
  Godown A sheet already loaded on D1. Godown B sheet (D2) has row 2 `R1 / OLD-0777`, row 3
  `OS-601 / bc-0001`, row 4 `OS-101 / OLD-0888` (OS-101 already loaded from Godown A, different barcode).
- **Steps:**
  1. Admin runs the Godown B load on D2.
- **Expected:**
  - Row 2 "A roll with this number already exists", row 3 "A roll with this barcode already
    exists", row 4 "A roll with this number already exists".
  - R1 and OS-101 unchanged (kg, godown, history, receipts). Nothing posted for rows 2–4.

### TC-OS-009 Messy spacing and case in codes are cleaned, not rejected
- **Status:** 🆕 to build
- **Covers:** load rules
- **Layer:** Auto
- **Given:** one row: roll no `" os-701 "`, barcode `"old-0701 "`, vendor `" arihant"`,
  RT `"rt 501 "`, material code in lower case, godown `"godown a"`, remark `" misprint"`.
- **Steps:**
  1. Admin runs the load.
- **Expected:** loads as roll no `OS-701`, barcode `OLD-0701`, vendor ARIHANT, RT 501, Godown A,
  remark MISPRINT. A tablet scan of `OLD-0701` finds it.
- **Note:** today registration already trims and upper-cases roll no, barcode, and matches
  RT/Delta codes case-insensitively; vendor/godown/material are picked by id, so the loader
  must match their codes the same way.

### TC-OS-010 A row that fails while posting leaves nothing behind
- **Status:** 🆕 to build
- **Covers:** OS-7 and I-1
- **Layer:** Auto
- **Given:** sheet S-A; the test makes ERPNext refuse OS-102's Purchase Receipt (e.g. the item is
  disabled between check and post).
- **Steps:**
  1. Admin runs the load.
- **Expected:** OS-102 listed in the error report; no Batch, Purchase Receipt (draft or
  submitted) or history row for it; OS-101 and OS-103 fully loaded; `ledger_mismatches` empty.

### TC-OS-011 Re-running the same sheet adds and changes nothing
- **Status:** 🆕 to build
- **Covers:** OS-8 and I-1
- **Layer:** Auto
- **Given:** S-A loaded on D1; on D2 OS-101 went out and returned 300 kg.
- **Steps:**
  1. Admin runs the load again with the unchanged S-A on D2.
- **Expected:**
  - Summary: 0 loaded, 3 already loaded (skipped), 0 errors.
  - Still 3 rolls; OS-101 still 300 kg with its 3 history rows; no new Purchase Receipt; D1 and
    D2 reports unchanged.

### TC-OS-012 Fix the rejected rows and re-run: only they load
- **Status:** 🆕 to build
- **Covers:** OS-7, OS-8
- **Layer:** Auto
- **Given:** first run of S-A + rows 5–9 of TC-OS-003 loaded rows 2–4, rejected 5–9.
- **Steps:**
  1. Team corrects rows 5–7 (vendor ARIHANT, material Base paper, godown Godown B), leaves 8–9.
  2. Admin re-runs the corrected sheet.
- **Expected:** summary 3 loaded (OS-105…107), 3 already loaded, 2 rejected (rows 8, 9 with the
  same reasons). D1 report Opening rises by the three new rows' kg.

### TC-OS-013 Rehearsal on a copy server changes nothing on production
- **Status:** 🆕 to build
- **Covers:** load rules (rehearsal)
- **Layer:** Manual
- **Given:** a copy server restored from production; the full real stock-take sheet.
- **Steps:**
  1. Admin runs the load on the copy.
  2. Team reviews the error report, OS-1 counts and the D1 report on the copy.
  3. Tester checks production.
- **Expected:** copy holds the loaded rolls and an error report; production still has 0 opening
  rolls, 0 Purchase Receipts from the load, and an unchanged "OLD RECORD" lot (or none).

### TC-OS-014 Godown-by-godown over 3 days with movements in between
- **Status:** 🆕 to build
- **Covers:** OS-1, OS-3, load rules (godown by godown) and I-2, I-5
- **Layer:** Both
- **Given:** sheets: Godown A = OS-101 (400), OS-102 (600); Godown B = OS-201 (RT 501, 800);
  Running Godown = OS-103 (500, Out). All Base paper.
- **Steps:**
  1. D1: admin loads the Godown A sheet.
  2. D1: operator scans OLD-0201 (a Godown B roll) for outward → refused.
  3. D2: operator takes OS-101 out to Running Godown (weighed 400).
  4. D2: admin loads the Godown B sheet.
  5. D3: operator returns OS-101 with 300 kg.
  6. D3: admin loads the Running Godown sheet.
- **Expected:**
  - Step 2: "Roll not found"; nothing posted.
  - OS-101 back in Godown A with 300 kg; OS-201 In stock 800 Godown B; OS-103 Out 500.
  - Base paper report 🔶 (opening includes what was loaded that day):

    | Day | Opening | Received | Consumed | Closing | Out on floor |
    |---|---|---|---|---|---|
    | D1 | 1000 | 0 | 0 | 1000 | 0 |
    | D2 | 1800 (1000 + 800 loaded) | 0 | 0 | 1800 | 400 |
    | D3 | 2300 (1800 + 500 loaded) | 0 | 100 | 2200 | 500 |
    | D4 | 2200 | 0 | 0 | 2200 | 500 |
    | Week D1–D7 | 2300 | 0 | 100 | 2200 | 500 |

  - `ledger_mismatches` empty after every step.

### TC-OS-015 Blank barcode gets a new label that scans
- **Status:** 🆕 to build
- **Covers:** load rules (blank barcode)
- **Layer:** Both
- **Given:** S-A (OS-102 has no barcode); no Barcode Batch for prefix `OS` on D1.
- **Steps:**
  1. Admin runs the load.
  2. Supervisor prints the labels listed in the load summary and sticks OS-102's on the roll.
  3. Operator scans the new label on the tablet.
- **Expected:**
  - OS-102 gets the next code of a saved Barcode Batch (e.g. `OS261104001` for prefix OS,
    date 2026-11-04 🔶 prefix), shown in the summary and on the Barcode generator's history.
  - The scan opens OS-102 (600 kg, Godown A).
  - A later run for the same prefix and date starts at 002 (the number stays spent).

### TC-OS-016 New label numbers never clash with old labels
- **Status:** 🆕 to build
- **Covers:** load rules (blank barcode)
- **Layer:** Auto
- **Given:** loaded roll OS-104 carries old label `RT261105003` (same shape as the generator's codes).
- **Steps:**
  1. Supervisor saves a Barcode generator run: prefix RT, date 2026-11-05, 1 to 10.
  2. Admin loads a sheet whose blank-barcode rows would get codes from that prefix and date.
- **Expected:** `RT261105003` is never issued again: the run skips it or is refused with
  "RT261105003 is already on roll OS-104" 🔶; no two rolls share a barcode.
- **Note:** today the generator only continues after earlier runs of the same prefix and date and
  does not look at roll barcodes, so it would print `RT261105003` again; registering a roll with it
  is then refused "A roll with this barcode already exists".

### TC-OS-017 Scan-to-confirm pass lists scanned and not-scanned rolls
- **Status:** 🆕 to build
- **Covers:** OS-4
- **Layer:** Manual
- **Given:** S-A loaded; OS-102 labelled with its new code.
- **Steps:**
  1. Operator starts the confirm pass for Godown A + Running Godown on the tablet.
  2. Operator scans OLD-0101, then OLD-0101 again.
  3. Operator scans OS-102's new label.
  4. Operator scans `OLD-0999` (a label not on the sheet).
  5. Supervisor opens the confirm-pass result on the portal.
- **Expected:**
  - Scanned 2: OS-101, OS-102 (the double scan counts once). Not scanned 1: OS-103 → listed for recount.
  - `OLD-0999` shown as "not on the sheet" 🔶 (see open questions); nothing created for it.
  - No movement, no stock change, no history row from scanning.

### TC-OS-018 Old roll: outward then return works out consumption
- **Status:** 🆕 to build
- **Covers:** OS-5 and I-1, I-2, I-6
- **Layer:** Both
- **Given:** S-A loaded D1.
- **Steps:**
  1. D2 operator takes OS-101 out to Running Godown (weighed 400).
  2. D3 operator returns OS-101 with 150 kg.
- **Expected:**
  - OS-101 In stock, 150 kg, back in Godown A.
  - History: Opening stock 400 · Outward 400 · Inward 150 (used 250).
  - ERPNext: transfer 400 A→Running (D2), Material Issue 250 and transfer 150 Running→A (D3).
  - D3 Base paper: consumed 250, closing 1250; RT 501 consumed 250.

### TC-OS-019 Old roll loaded as out on the floor: its return works out consumption
- **Status:** 🆕 to build
- **Covers:** OS-5 and I-2, I-4
- **Layer:** Both
- **Given:** S-A loaded D1 (OS-103 Out, 500, Running Godown).
- **Steps:**
  1. D2 operator returns OS-103 with 200 kg.
  2. D3 operator takes a second old floor roll (OS-104, loaded Out 300) and records return 0 (used up).
- **Expected:**
  - OS-103 In stock, 200 kg, in the storage godown chosen at return 🔶; D2 consumed 300.
  - OS-104 Consumed, 0 kg, no godown; D3 consumed 300.
  - Out on floor drops from 800 to 300 on D2 and to 0 on D3.
- **Note:** today a return goes back to the godown read off the roll's last Outward row; an old
  floor roll has none, so it would stay In stock **in Running Godown**.

### TC-OS-020 Old roll: return to vendor, partial then whole
- **Status:** 🆕 to build
- **Covers:** OS-5, AC-07b, AC-04 and I-4
- **Layer:** Both
- **Given:** Godown B sheet loaded D1: OS-201 ARIHANT RT 501, 800 kg, Godown B.
- **Steps:**
  1. D2 operator returns 300 kg of OS-201 to vendor.
  2. D4 operator returns the rest to vendor.
- **Expected:**
  - After D2: In stock 500, Godown B; ERPNext Purchase Return 300 against OS-201's opening
    receipt; D2 RT 501 Returned to vendor 300, closing 300 lower than D1.
  - After D4: Returned to vendor, 0 kg, no godown; Purchase Return 500; D4 Returned to vendor 500.

### TC-OS-021 Old roll: sale, partial then whole
- **Status:** 🆕 to build (partial sale is 🆕, AC-08b)
- **Covers:** OS-5, AC-05, AC-08b
- **Layer:** Both
- **Given:** S-A loaded D1 (OS-102 600, Godown A).
- **Steps:**
  1. D2 operator sells 250 kg of OS-102 to Direct Sale.
  2. D3 operator sells the rest.
- **Expected:** after D2 In stock 350, Delivery Note 250, D2 Sold 250; after D3 Sold, 0 kg,
  Delivery Note 350, D3 Sold 350.

### TC-OS-022 Old roll: portal godown move keeps it opening stock
- **Status:** 🆕 to build
- **Covers:** OS-5, AC-06, E-3
- **Layer:** Both
- **Given:** S-A loaded D1; OS-101 not moved; OS-102 went out and came back 600 on D2.
- **Steps:**
  1. D3 supervisor edits OS-101 → Location Godown B → Save.
  2. D3 supervisor edits OS-102 → Location Godown B → Save.
- **Expected:**
  - Both In stock in Godown B, same kg; no new history row.
  - OS-101 (unmoved): its opening receipt is re-posted into Godown B, dated D1 (TC-COR-003);
    it is **still flagged opening stock** and in lot OLD RECORD; D1 report still Opening 1500, Received 0.
  - OS-102 (moved): stock transfer 600 A→B on D3 (TC-COR-007).
  - Reports: no received/consumed change on any day.

### TC-OS-023 Portal weight correction of a loaded roll before it moves
- **Status:** 🆕 to build
- **Covers:** E-3, OS-3
- **Layer:** Auto
- **Given:** S-A loaded D1; stock-take typo: OS-101 should be 420.
- **Steps:**
  1. D2 supervisor edits OS-101 → Weight 420 → Save.
- **Expected:** arrival 420, current 420; history 1 row "Opening stock 420 kg"; receipt
  re-posted dated D1; D1 report Opening 1520, Received 0; D2 opening 1520; still opening stock.

### TC-OS-024 First outward compares with the stock-take weight
- **Status:** 🆕 to build
- **Covers:** OS-6, AC-09
- **Layer:** Both
- **Given:** S-A loaded D1 (OS-101 400, OS-102 600 in Godown A); tolerance 1 kg or 1 % 🔶.
- **Steps:**
  1. D5 operator takes OS-101 out; scale shows 397.
  2. D5 operator takes OS-102 out; scale shows 590.
- **Expected:**
  - OS-101: out at 400, no store-loss row, no alert (3 kg ≤ 4 kg tolerance).
  - OS-102: history "Store loss 10 kg" then "Outward 590"; D5 Store loss 10 for Base paper and RT 502;
    alert "OS-102 weighed 590 kg at outward — 10 kg less than the 600 kg recorded (last weighed D1
    in Godown A)".
  - No alert anywhere refers to an "original" arrival weight (none was entered).

### TC-OS-025 Loaded totals match the sheet and Savio
- **Status:** 🆕 to build
- **Covers:** OS-1, OS-2
- **Layer:** Manual
- **Given:** all godown sheets loaded; Savio's stock per material at the cut-off.
- **Steps:**
  1. Tester exports roll counts and kg per godown × design from the portal.
  2. Tester compares them with the sheets, and kg per material with Savio.
- **Expected:** every godown × design count and kg equals the sheet (rejected rows excepted and
  listed); `ledger_mismatches` empty; per-material difference to Savio is 0 or each difference is
  written down with its reason and signed off.

### TC-OS-026 Minimum stock is set after the load: no alert flood
- **Status:** 🆕 to build
- **Covers:** load rules (minimum stock), AC-10
- **Layer:** Auto
- **Given:** no design has a minimum; S-A loaded D1 (RT 501: 400 in store, 500 out on floor).
- **Steps:**
  1. D1 tester opens the alerts page.
  2. D2 supervisor sets RT 501 minimum 1500 kg.
- **Expected:** after step 1, 0 low-stock alerts. After step 2, exactly one alert "RT 501 below
  minimum: 400 kg in store, minimum 1500" (the floor roll does not count); none for RT 502.

---

## Portal roll corrections

Given for this section: R20 registered on the tablet D1, 1000 kg, Base paper, ARIHANT RT 501,
Godown A, rate per roll 50,000 — **unmoved** (history 1 row). R21 registered D1 1000 kg Godown A,
D2 outward to Running Godown, D3 returned 600 → In stock 600, Godown A — **moved** (history 3 rows).
Corrections are made by `sup1` on D5 via Master → Rolls → Edit.

### TC-COR-001 Unmoved roll: weight corrected, receipt re-posted, history stays one row
- **Status:** ✅ today
- **Covers:** E-3 and I-1, I-2, I-6
- **Layer:** Both
- **Given:** R20 (unmoved).
- **Steps:**
  1. Supervisor opens Edit on R20: the form shows one "Weight" field ("This roll has not moved, so
     this is both what arrived and what is on it now").
  2. Supervisor sets Weight 980 → Save.
- **Expected:**
  - "Saved". R20 In stock, arrival 980, current 980, Godown A.
  - History: still 1 row, Received 980.
  - ERPNext: the original Purchase Receipt cancelled; a new one (amended from it) for 980 kg into
    Godown A, posted D1 at the original time, same rate per roll 50,000.
  - D1 report Received 980, Closing 980 (D1 itself changes, not D5).

### TC-COR-002 Unmoved roll: material corrected
- **Status:** ✅ today
- **Covers:** E-3 and I-1, I-2
- **Layer:** Both
- **Given:** R20 (unmoved), Base paper.
- **Steps:**
  1. Supervisor edits R20 → Material Coated paper → Save.
- **Expected:** R20 is Coated paper, same roll id, 1000 kg; history 1 row; receipt replaced for
  Coated paper; D1 report (R20 the only roll that day): Base paper Received 0, Coated paper Received 1000.

### TC-COR-003 Unmoved roll: godown corrected by re-posting the receipt
- **Status:** ✅ today
- **Covers:** E-3, AC-06 and I-1
- **Layer:** Both
- **Given:** R20 (unmoved), Godown A.
- **Steps:**
  1. Supervisor edits R20 → Location Godown B → Save.
- **Expected:** R20 In stock 1000 in Godown B; history 1 row with "to" Godown B; ERPNext: receipt
  replaced into Godown B dated D1 (no Stock Entry); reports unchanged.

### TC-COR-004 Unmoved roll: weight, material and godown in one save → one replacement receipt
- **Status:** ✅ today
- **Covers:** E-3
- **Layer:** Auto
- **Given:** R20 (unmoved).
- **Steps:**
  1. Supervisor sets Weight 980, Material Coated paper, Location Godown B → Save.
- **Expected:** exactly one cancelled and one new Purchase Receipt (980 kg, Coated paper, Godown B,
  D1); history 1 row with those values.

### TC-COR-005 Unmoved roll: weight and current must match
- **Status:** ✅ today
- **Covers:** E-3
- **Layer:** Auto
- **Given:** R20 (unmoved).
- **Steps:**
  1. Via the API, send weight 980 and remaining weight 1000.
  2. Via the API, send weight 0 and remaining weight 0.
- **Expected:**
  - Step 1 refused: "This roll hasn't moved yet, so it still holds what arrived on it — weight and
    remaining weight must be the same". Step 2 refused: "Weight must be greater than 0".
  - R20 unchanged, same receipt, history 1 row.
  - (The portal form cannot send this: it shows one field and sends both.)

### TC-COR-006 Moved roll: current kg corrected → "Adjusted" history row
- **Status:** ✅ today
- **Covers:** E-4 and I-1, I-2, I-6
- **Layer:** Both
- **Given:** R21 (moved), 600 kg in Godown A.
- **Steps:**
  1. Supervisor opens Edit: "Weight on arrival" 1000 is locked ("Locked — this roll has already moved").
  2. Supervisor sets Current weight 550 → Save.
  3. Supervisor sets Current weight 580 → Save.
  4. Supervisor sets Current weight 1100 → Save.
- **Expected:**
  - After 2: 550 kg; new history row "Adjusted" 50 kg, balance 550, note "Corrected on the
    portal", dated D5; ERPNext Material Issue 50 from Godown A; D5 report Adjusted −50, closing 550.
  - After 3: 580; Adjusted row 30, Material Receipt 30; D5 Adjusted net −20.
  - Step 4 refused: "This roll only ever held 1000 kg — the counted amount cannot be higher"; stays 580.
  - D1–D3 reports unchanged; arrival stays 1000.
- **Note:** the portal's hint under Current weight says "Corrected on the roll — no new movement";
  the backend does write an Adjusted row. The hint must be corrected.

### TC-COR-007 Moved roll: godown corrected by a stock transfer, no history row
- **Status:** ✅ today
- **Covers:** AC-06 and I-1, I-6
- **Layer:** Both
- **Given:** R21 (moved), 600 kg in Godown A.
- **Steps:**
  1. Supervisor edits R21 → Location Godown B → Save.
- **Expected:** In stock 600 in Godown B; ERPNext Material Transfer 600 A→B posted D5; history
  still 3 rows; no report figure changes.

### TC-COR-008 Moved roll: material and arrival weight are locked
- **Status:** ✅ today
- **Covers:** E-4
- **Layer:** Auto
- **Given:** R21 (moved).
- **Steps:**
  1. Supervisor edits R21 → Material Coated paper → Save.
  2. Via the API, send weight 900.
- **Expected:** step 1 "Material can't be changed after the roll has moved"; step 2 "Weight is
  locked once the roll has moved". R21 unchanged; nothing posted.

### TC-COR-009 Out on the floor: godown change refused, current kg still correctable
- **Status:** ✅ today
- **Covers:** AC-06, E-4
- **Layer:** Both
- **Given:** R22 in 800 D1 Godown A, D4 outward → Out, 800, Running Godown.
- **Steps:**
  1. Supervisor edits R22 → Location Godown B → Save.
  2. Supervisor edits R22 → Current weight 780 → Save.
- **Expected:** step 1 "This roll is out — record its return before changing its location",
  nothing posted. Step 2: Adjusted row 20; Material Issue 20 from Running Godown; roll stays Out, 780.

### TC-COR-010 Finished roll cannot be corrected
- **Status:** ✅ today
- **Covers:** I-4
- **Layer:** Both
- **Given:** R23 sold D2; R24 returned to vendor D2; R25 consumed D3.
- **Steps:**
  1. Supervisor looks at the Edit button for each on the Rolls list.
  2. Via the API, send location Godown B, then remaining weight 50, for R23.
- **Expected:**
  - Edit disabled with tooltip "This roll was sold, so it can no longer be edited." / "…was
    returned to its vendor…" / "…is consumed…".
  - API: "This roll holds no stock in a godown, so its location can't be changed" and "This roll
    is finished, so its remaining weight can no longer be corrected". Rolls stay 0 kg, no godown.

### TC-COR-011 A refused mixed edit writes nothing
- **Status:** ✅ today
- **Covers:** E-3, E-4 and I-1
- **Layer:** Auto
- **Given:** R21 (moved), 600 kg, GSM 70.
- **Steps:**
  1. Supervisor changes Current weight 550, GSM 80 and Material Coated paper in one save.
- **Expected:** refused "Material can't be changed after the roll has moved"; R21 still 600 kg,
  GSM 70, Base paper; no Adjusted row, no Stock Entry; `ledger_mismatches` empty.

### TC-COR-012 Inactive or unknown godown/material refused
- **Status:** ✅ today
- **Covers:** E-3
- **Layer:** Both
- **Given:** R20 (unmoved); Godown B deactivated; Coated paper deactivated.
- **Steps:**
  1. Supervisor opens the Location and Material lists on Edit.
  2. Via the API, send location Godown B; then material Coated paper; then location "no-such-place".
- **Expected:** lists show active entries only (plus the roll's own). API: "Godown B is inactive —
  pick a different location"; "Coated paper is inactive — reactivate it before booking stock against
  it"; "That location no longer exists — pick another". Nothing posted.

### TC-COR-013 Saving with nothing changed posts nothing
- **Status:** ✅ today
- **Covers:** E-3
- **Layer:** Both
- **Given:** R20 (unmoved).
- **Steps:**
  1. Supervisor opens Edit and saves without changing anything.
  2. Via the API, send the roll's own weight, material and location.
- **Expected:** step 1 "Nothing changed."; step 2 accepted; in both, the same Purchase Receipt
  stays submitted, no new document, history 1 row.

### TC-COR-014 The tablet sees the correction after sync
- **Status:** ✅ today
- **Covers:** E-3, E-4 and I-6
- **Layer:** Manual
- **Given:** tablet synced on D5 morning; then TC-COR-001 and TC-COR-006 applied.
- **Steps:**
  1. Operator pulls to sync on the tablet.
  2. Operator opens R20 and R21.
- **Expected:** R20 shows 980 / 980 and one history row; R21 shows 550 with the Adjusted row.
  An outward of R20 now goes out at 980.

---

## Delete a roll with history

### TC-DEL-001 Deleting a roll reverses all its stock documents
- **Status:** ✅ today
- **Covers:** E-6 and I-1, I-3
- **Layer:** Both
- **Given:** R30 in 1000 D1 Godown A → D2 outward → D3 return 600 → D4 sold 600 to Direct Sale
  (history 4 rows).
- **Steps:**
  1. D6 supervisor clicks Delete on R30: dialog "Delete roll R30?" shows "This deletes the roll
     and its entire history", Current weight 0 kg, Status SOLD, History "4 movements".
  2. Supervisor clicks "Delete roll and history".
- **Expected:**
  - "Roll R30 deleted"; R30 gone from the Rolls list and roll search.
  - ERPNext: Delivery Note, both Material Transfers, Material Issue and Purchase Receipt all
    cancelled (docstatus 2), newest first; batch balance 0 in every godown.
  - The roll and its 4 rows are kept, marked deleted (traceable in ERPNext), not erased.

### TC-DEL-002 Past reports stop counting a deleted roll
- **Status:** ✅ today
- **Covers:** E-6 and I-2, I-5
- **Layer:** Auto
- **Given:** R30 as TC-DEL-001 plus R31 in 500 D1 (untouched). Reports before deleting: D1
  Received 1500, D3 Consumed 400, D4 Sold 600, D4 Closing 500.
- **Steps:**
  1. D6 supervisor deletes R30.
  2. Tester re-opens D1–D4 daily, the week D1–D7 and the CSVs.
- **Expected:** D1 Received 500; D3 Consumed 0; D4 Sold 0; closing 500 every day; R30 absent from
  the daily roll report and its CSV for every day.

### TC-DEL-003 Deleting after a portal godown move cancels the transfer first
- **Status:** ✅ today
- **Covers:** E-6 and I-1
- **Layer:** Auto
- **Given:** R32 in 700 D1 → D2 outward → D3 return 700 → D4 portal move A→B (transfer, no row).
- **Steps:**
  1. Supervisor deletes R32.
- **Expected:** the D4 transfer, then the D3 and D2 documents, then the receipt are cancelled
  without error; balance 0 in Godown A, Godown B and Running Godown.

### TC-DEL-004 Roll no and barcode can be used again after delete
- **Status:** ✅ today
- **Covers:** E-6
- **Layer:** Auto
- **Given:** R30 (barcode BC-0030) deleted.
- **Steps:**
  1. Operator registers a new roll with roll no R30 and barcode BC-0030, 900 kg.
  2. Operator scans BC-0030.
- **Expected:** accepted as a **new** roll (different id) with 1 history row; the scan opens the
  new roll; the deleted roll's history is not attached to it.

### TC-DEL-005 The tablet drops a deleted roll; a queued movement for it is refused
- **Status:** ✅ today
- **Covers:** E-6, T-5
- **Layer:** Manual
- **Given:** tablet offline; operator records an outward of R33 on it; meanwhile supervisor
  deletes R33 on the portal.
- **Steps:**
  1. Tablet comes online and syncs.
- **Expected:** R33 disappears from the tablet's roll list; the queued outward is refused "Roll not
  found" and shown as failed; nothing posted in ERPNext.

### TC-DEL-006 Deleting a wrongly loaded opening-stock roll lowers that day's Opening
- **Status:** 🆕 to build
- **Covers:** E-6, OS-3
- **Layer:** Auto
- **Given:** S-A loaded D1; OS-102 turns out to be a duplicate entry.
- **Steps:**
  1. D2 supervisor deletes OS-102.
- **Expected:** opening receipt cancelled; D1 Base paper Opening 900, Closing 900; D2 opening 900;
  OS-102 can be re-loaded by re-running the sheet (TC-OS-011 then loads it as new).

---

## Master data rules that affect inventory

### TC-MST-001 A vendor with live rolls cannot be deactivated
- **Status:** ✅ today
- **Covers:** inventory protection (I-1)
- **Layer:** Both
- **Given:** ARIHANT has R40 In stock (Godown A) and R41 Out (Running Godown).
- **Steps:**
  1. Supervisor sets ARIHANT inactive on Master → Vendors.
  2. R40 sold and R41 returned 0 (consumed); supervisor tries again.
- **Expected:** step 1 refused "ARIHANT still has rolls in stock or out — finish them before
  deactivating"; vendor stays active. Step 2 accepted; finished rolls keep ARIHANT as vendor and
  past reports are unchanged.

### TC-MST-002 A material with live rolls cannot be deactivated
- **Status:** ✅ today
- **Covers:** inventory protection
- **Layer:** Both
- **Given:** Base paper has R40 In stock.
- **Steps:**
  1. Supervisor sets Base paper inactive on Master → Material types.
- **Expected:** "Base paper still has rolls in stock or out — finish them before deactivating";
  stays active.

### TC-MST-003 A godown holding stock cannot be deactivated
- **Status:** ✅ today
- **Covers:** I-1
- **Layer:** Both
- **Given:** Godown A holds R40 (1000 kg); Running Godown holds R41 (out).
- **Steps:**
  1. Supervisor sets Godown A inactive on Master → Locations.
  2. Supervisor sets Running Godown inactive.
- **Expected:** both refused, "Warehouse Godown A - RT cannot be disabled as stock exists for Item
  <Base paper's code>" (ERPNext's own message 🔶 wording to be made friendlier); both stay active.

### TC-MST-004 A godown whose only roll is out on the floor can be deactivated
- **Status:** ✅ today
- **Covers:** AC-03
- **Layer:** Auto
- **Given:** Godown B's only roll R42 (800 kg) went out to Running Godown on D2.
- **Steps:**
  1. D3 supervisor sets Godown B inactive (accepted: it holds 0 kg).
  2. D4 operator returns R42 with 500 kg.
- **Expected:** R42 In stock 500, stays in **Running Godown** (it cannot go back to an inactive
  godown); D4 consumed 300; ledger 500 in Running Godown. 🔶 see open questions.

### TC-MST-005 An inactive godown, vendor or material is not offered for new movements
- **Status:** ✅ today
- **Covers:** AC-01, AC-03
- **Layer:** Both
- **Given:** Godown B (empty), BALAJI (no live rolls) and Coated paper (no live rolls) deactivated D1.
- **Steps:**
  1. Operator syncs the tablet and opens Register roll and Outward.
  2. Via the API, register a roll in Godown B; with vendor BALAJI; with material Coated paper.
  3. Via the API, send R40 outward to Godown B.
- **Expected:** tablet greys out / hides the three; portal pickers list only active entries.
  API refusals: "Godown B is inactive — pick a different location", "BALAJI is inactive — pick a
  different vendor", "Coated paper is inactive — reactivate it before booking stock against it".
  Nothing posted.

### TC-MST-006 Supplier, paper, godown and material codes are upper-cased and unique
- **Status:** ✅ today
- **Covers:** load rules (codes), TC-OS-009
- **Layer:** Auto
- **Given:** vendor ARIHANT exists.
- **Steps:**
  1. Supervisor creates vendor code `" balaji2 "` with paper RT `" rt 701"`, Delta `"dl 9n"`,
     supplier code `"ab-12"`.
  2. Supervisor creates vendor code `"arihant"`.
  3. Supervisor creates location code `" gdc "` and material code `"cp "`.
- **Expected:** stored as `BALAJI2`, `RT 701`, `DL 9N`, `AB-12`, `GDC`, `CP`. Step 2 refused "A vendor
  with this code already exists".

### TC-MST-007 Paper code search finds a paper by any of its codes, any case
- **Status:** ✅ today
- **Covers:** AC-01 (picking the design)
- **Layer:** Both
- **Given:** ARIHANT papers RT 501 / Delta 730N (supplier code AR-77), RT 502; BALAJI RT 601.
- **Steps:**
  1. Supervisor searches Master → Paper Codes for `501`, `730n`, `ar-7`, `bala`, `zzz`.
- **Expected:** `501` → the ARIHANT RT 501 row; `730n` → same row; `ar-7` → same row; `bala` →
  BALAJI's RT 601 row (matches vendor name); `zzz` → no rows. Each row names its vendor.

---

## Roles and access

| Page / action (today's code) | Operator | Supervisor | Admin | Super admin |
|---|---|---|---|---|
| Portal login | refused | yes | yes | yes |
| Masters, Rolls, Lots, Barcode generator, Download app | – | yes | redirected to User management | yes |
| Reports and CSVs | – | yes | refused | yes |
| User management | – | operators only | godown accounts | godown accounts |
| Delete a godown account | – | – | yes (suspends) | yes |
| Rate per roll visible | no | no | yes | yes |

### TC-ROLE-001 An operator can't log in to the portal
- **Status:** ✅ today
- **Covers:** E-8
- **Layer:** Both
- **Given:** `op1` active, password set.
- **Steps:**
  1. `op1` signs in on the portal with the right password.
  2. `op1` reloads the portal and types `/masters/rolls`.
  3. `op1` signs in on the tablet.
- **Expected:** step 1 "This account is for the mobile app."; step 2 lands on the login page (no
  session kept); step 3 works.
- **Note:** today the refusal is in the portal screen only: the server signs the operator in and its
  token is accepted by the portal's roll edit/delete and masters endpoints (they allow all godown
  roles, as Node did). To meet E-8 fully the server must refuse those endpoints to operators.

### TC-ROLE-002 Supervisor's portal: godown pages, reports, operators
- **Status:** ✅ today
- **Covers:** E-8
- **Layer:** Manual
- **Given:** `sup1`.
- **Steps:**
  1. `sup1` signs in.
  2. `sup1` opens each menu entry, edits a roll, downloads the daily roll CSV.
- **Expected:** lands on Master → Vendors; menu: Barcode generator, Master (Vendors, Locations,
  Material types, Remarks, Paper Codes, Lots, Rolls), Reports, User management, Download app — all open;
  edit and CSV work.

### TC-ROLE-003 Admin's portal today: User management only
- **Status:** 🔶 value to confirm
- **Covers:** E-8
- **Layer:** Both
- **Given:** `adm1`.
- **Steps:**
  1. `adm1` signs in.
  2. `adm1` types `/masters/rolls`, then `/reports`.
  3. Via the API, `adm1` asks for the consumption report and the daily roll CSV.
- **Expected (today's code):** lands on User management, the only menu entry; both URLs redirect to
  User management; API "You do not have permission to perform this action".
- **Note:** the acceptance doc gives admin the Alerts page; whether admin should also see Rolls and
  Reports is an open question.

### TC-ROLE-004 Super admin passes everywhere but can't be changed from the panel
- **Status:** ✅ today
- **Covers:** E-8
- **Layer:** Both
- **Given:** `sa1`, `adm1`.
- **Steps:**
  1. `sa1` signs in and opens every menu entry.
  2. `adm1` tries to change `sa1`'s status to suspended, and to delete `sa1`.
- **Expected:** step 1 all pages open (landing User management). Step 2 "Super admin accounts can
  only be changed directly in the database".

### TC-ROLE-005 Only supervisors and above see alerts
- **Status:** 🆕 to build
- **Covers:** E-8, Alerts page
- **Layer:** Both
- **Given:** one open store-loss alert (AC-09).
- **Steps:**
  1. `sup1`, `adm1`, `sa1` each open Alerts.
  2. Via the API, `op1` asks for the alert list.
- **Expected:** the three see the alert and the menu badge "1"; `op1` gets "You do not have
  permission to perform this action".
- **Note:** today admin's menu has no godown pages (TC-ROLE-003); Alerts must be added for admin.

### TC-ROLE-006 Godown roles never see the rate per roll
- **Status:** ✅ today
- **Covers:** E-8, AC-05
- **Layer:** Auto
- **Given:** R50 registered with rate per roll 50,000; R51 sold to Direct Sale with rate 3,000.
- **Steps:**
  1. `op1` and `sup1` sync / pull on the tablet and read the sync replies.
  2. `sup1` opens R50 and R51 history on the portal and downloads every report CSV.
  3. `op1` and `sup1` call ERPNext's rate lookups (incoming rate, valuation rate, stock balance).
  4. `adm1` reads R51's sale movement.
- **Expected:** no `rate_per_roll` field in any reply for `op1`/`sup1`; no price column in any CSV
  (for anyone); rate lookups "You do not have permission to perform this action"; `adm1` sees 3,000.

### TC-ROLE-007 A suspended account is refused everywhere
- **Status:** ✅ today
- **Covers:** E-8
- **Layer:** Both
- **Given:** `op1` signed in on a tablet; `op1` was sent a reset link; then `sup1` suspends `op1`.
- **Steps:**
  1. `op1` signs in with the right password; then with a wrong one.
  2. `op1`'s running tablet session refreshes.
  3. `op1` opens the earlier reset link.
- **Expected:** step 1 "Your account has been suspended" / "Invalid email or password" (a wrong
  password never reveals the suspension). Step 2 "Session expired. Please sign in again." Step 3
  "This reset link is invalid or has expired". No movement can be recorded as `op1`.

### TC-ROLE-008 A supervisor manages operators only
- **Status:** ✅ today
- **Covers:** E-8
- **Layer:** Auto
- **Given:** `sup1`, `sup2` (supervisor), `op1`, `adm1`.
- **Steps:**
  1. `sup1` invites a new supervisor.
  2. `sup1` suspends `sup2`.
  3. `sup1` sets `sup2`'s password.
  4. `sup1` deletes `op1`.
  5. `sup1` lists users.
  6. `sup1` invites an operator, suspends `op1`, sets an operator's password.
- **Expected:** 1 "Godown supervisors can only invite godown operators"; 2 "Supervisors can only edit
  operators"; 3 "Supervisors can only set an operator's password"; 4 "You do not have permission to
  perform this action"; 5 only godown accounts (no `adm1`, no `sa1`); 6 all accepted.

### TC-ROLE-009 Admin manages godown accounts, not other admins
- **Status:** ✅ today
- **Covers:** E-8
- **Layer:** Auto
- **Given:** `adm1`, `adm2` (RT Admin), `op1`.
- **Steps:**
  1. `adm1` suspends `adm2`.
  2. `adm1` deletes its own account.
  3. `adm1` deletes `op1`.
- **Expected:** 1 "This account is managed outside this panel"; 2 "You cannot delete your own
  account"; 3 `op1` becomes suspended (never erased).

### TC-ROLE-010 An account with no Royale Touche role can't sign in
- **Status:** ✅ today
- **Covers:** E-8
- **Layer:** Auto
- **Given:** ERPNext user `acct1` with only an accounts role.
- **Steps:**
  1. `acct1` signs in on the tablet or portal.
- **Expected:** "You do not have access to the Royale Touche app"; no token issued.

### TC-ROLE-011 Photos are private
- **Status:** ✅ today
- **Covers:** E-8, AC-01
- **Layer:** Both
- **Given:** R50 with front photo `/private/files/r50-front.jpg`.
- **Steps:**
  1. Open the photo URL in a browser with no login.
  2. `sup1` opens R50 on the portal and clicks the photo.
  3. Via the API, register a roll whose photo is `https://example.com/x.jpg`, then `/private/files/notes.txt`.
- **Expected:** step 1 HTTP 403, no image; step 2 photo shows; step 3 "Photos must be files uploaded
  to this server" for both, nothing posted.

---

## Open questions for the business

1. **Stock-take sheet format.** Please share a sample sheet (Excel or CSV, one tab per godown or one
   tab for all?) with real vendor codes, RT/Delta codes and old label formats, so TC-OS-003…009 use
   real values. Is GSM / width always known for old rolls, or may they be blank?
2. **Roll found during the scan pass that isn't on the sheet** (TC-OS-017): add it on the spot on
   the tablet (as opening stock, weighed then), add it to a follow-up sheet, or set it aside?
   And a roll scanned in a different godown than the sheet says: move it on the system, or recount?
3. **Duplicates within a sheet** (TC-OS-007): reject both rows (proposed), or keep the first?
4. **Re-run with a changed row** (TC-OS-011): if a re-run sheet has an already loaded roll with a
   different kg or godown, should the load ignore it, report it, or correct the roll?
5. **Staggered load in the reports** (TC-OS-014): on D2 and D3, show Godown B's and the floor's
   loaded kg inside Opening (so D2 opening ≠ D1 closing), or as a separate "Opening stock loaded"
   column?
6. **Floor rolls loaded as Out** (TC-OS-019): when they come back, which storage godown do they
   return to (operator picks, or a godown column on the sheet)? Today they would stay in Running
   Godown. And their history: one "Opening stock" row only, or "Opening stock" + "Outward"?
7. **Value of old stock:** is a rate per roll entered for old rolls (needed for valuation and vendor
   returns in ERPNext), or are they loaded at zero value?
8. **Label prefix for new labels** printed at the load (TC-OS-015), and the format of the old labels
   (so TC-OS-016 can prove no clash).
9. **Admin on the portal** (TC-ROLE-003): today admin sees only User management and is refused the
   reports. Should admin also see Rolls, Masters, Reports and Alerts?
10. **Who may delete a roll with history** (TC-DEL-001): today any godown role (supervisor, and the
    operator through the API). Restrict to supervisor and above, or admin only?
11. **Deactivating a godown while its roll is out** (TC-MST-004): allow it (the roll then stays in
    Running Godown on return), or refuse until rolls that went out from it come back?
12. **Error report wording** (🔶 in TC-OS-003…008): confirm the row-message style
    "Row 5 · OS-105 · vendor ARIHANTT not found".
