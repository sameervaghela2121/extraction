# Test cases 01: core roll movements

Part of the acceptance test catalogue for
[2026-11-04-inventory-acceptance.md](../2026-11-04-inventory-acceptance.md). That document is
the authority for decisions, for the 🆕/🔶 marks and for invariants I-1 to I-6. Every expected
refusal message below is copied exactly from the code
(`erpnext/royal_touche/royal_touche/rolls.py`, `movements.py`, `dates.py`).

**Not covered here** (they have their own sections): partial return to vendor (AC-07b 🆕), partial
sale (AC-08b 🆕), store loss at outward (AC-09 🆕), low stock (AC-10 🆕), portal godown moves
(AC-06), portal corrections and delete (E-3, E-4, E-6), multi-day timelines (T-1 to T-6), sync
retries and races (E-1, E-2), opening stock.

## Conventions for every case

- **Setup.** The shared setup from the acceptance document: Godown A and Godown B (storage),
  Running Godown (production floor); material Base paper; vendor ARIHANT with designs
  RT 501 / Delta 730N and RT 502; users operator (tablet), supervisor (portal), admin.
  Extra for this section: a lot (challan) **CH-100** from ARIHANT; remark master entries
  **MISPRINT** ("Misprint") and **COLOR-VAR** ("Colour variation"); a buyer **Kumar Traders**
  next to the built-in **Direct Sale**. The remark labels are placeholders. Use whatever the
  team enters.
- **Rolls.** Every case starts from an empty stock with only its own **Given**. Roll numbers
  (R1, R2…) and barcodes (BC001…) are local to the case. "Arrival" is the registered weight.
  "Current" is the kg on the roll now.
- **Days.** D1, D2… are IST calendar days. The server's clock is set to the day the step happens
  unless the case says otherwise. Movements go through the same API the tablet uses (sync).
- **Refusals.** A refused action returns the quoted message (through sync: item `status: failed`,
  `error` = the message, `reason` in brackets, e.g. *(conflict)*). "Nothing is posted" means no
  Roll Movement, no ERPNext stock document, and the roll unchanged (status, kg, godown, ledger).
- **Checked after every case, not repeated below:** I-1 (ERPNext batch balance = the roll's
  current kg in its godown), I-3 (no negative stock) and I-4 (a finished roll has 0 kg and no
  godown), unless a **Note** says otherwise.
- **Report figures** are from the consumption report (by material: Base paper; by design: the
  roll's design) for that single day: Received / Consumed / Returned to vendor / Sold /
  Adjusted / Closing / Out on floor at close. Figures not named are 0. "Daily roll report" is
  the per-roll daily status report and its CSV.
- **History text** is the portal's one-line description of each movement:
  `Received 1000 kg` · `Issued out 1000 kg to Running Godown` ·
  `Returned 600 kg to Godown A · 400 kg used` · `Consumed — 1000 kg used up` ·
  `Returned to vendor ARIHANT — 500 kg` · `Sold — 800 kg` · `Corrected by 50 kg`.

---

## Roll registration / inward (AC-01)

### TC-IN-001 Register a roll with every field
- **Status:** ✅ today
- **Covers:** AC-01, I-1, I-2, I-6
- **Layer:** Both
- **Given:** D1, nothing registered. Lot CH-100 exists.
- **Steps:**
  1. Operator on tablet registers R1: barcode BC001, roll no R1, lot CH-100, vendor ARIHANT,
     design RT 501, material Base paper, GSM 50, width 1000 mm, weight 1000 kg, godown
     Godown A, date D1, tag, barcode, front and back photos.
  2. Operator syncs.
  3. Supervisor opens the roll and the lot on the portal.
- **Expected:**
  - Roll R1: status **In stock**, arrival 1000, current 1000, Godown A, vendor ARIHANT,
    RT code RT 501 / Delta 730N, lot CH-100.
  - History: exactly 1 row, `Received 1000 kg`, dated D1.
  - ERPNext: one submitted **Purchase Receipt** from ARIHANT, 1000 kg Base paper, batch = R1,
    warehouse Godown A. Batch balance in Godown A = 1000.
  - Reports D1 (Base paper and RT 501): Received 1000, Closing 1000, Out on floor 0.
  - Daily roll report D1: one row R1, Last movement "Received", Weight on arrival 1000,
    Final weight 1000, Final status "In stock", Last location Godown A.
  - Portal: R1 is listed and its photos open. Lot CH-100 shows its challan photo.

### TC-IN-002 Registration photos are kept and shown on the received row
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Both
- **Given:** D1. The operator has taken the tag, barcode, front and back photos on the tablet.
- **Steps:**
  1. Operator registers R1 (as TC-IN-001) with all 4 photos and syncs.
  2. Supervisor opens R1 and its history on the portal.
- **Expected:** all 4 photos are stored on the roll (tag, barcode, side 1, side 2) and open on
  the portal. The `Received 1000 kg` history row lists the same 4 photos. A roll registered
  with no photos shows none on that row.

### TC-IN-003 A photo that is not an upload on this server is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register R1 with `side1_photo` = `https://example.com/x.jpg` (not a file uploaded to the
     server).
  2. Register R1 again with `side1_photo` = `/private/files/does-not-exist.jpg`.
- **Expected:** both refused: "Photos must be files uploaded to this server" *(validation)*.
  Nothing is posted. No roll R1 exists.

### TC-IN-004 Same roll number twice is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Both
- **Given:** D1. R1 (barcode BC001) registered, 1000 kg, Godown A.
- **Steps:**
  1. Operator registers another roll with roll no `R1`, barcode BC002.
  2. Operator registers another roll with roll no ` r1 ` (lower case, spaces), barcode BC003.
- **Expected:** both refused: "A roll with this number already exists" *(duplicate)*. Nothing
  is posted. Only one roll R1 exists. Reports D1 still show Received 1000.

### TC-IN-005 Same barcode twice is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Both
- **Given:** D1. R1 with barcode BC001 registered.
- **Steps:**
  1. Operator registers R2 with barcode `BC001`.
  2. Operator registers R3 with barcode `bc001`.
- **Expected:** both refused: "A roll with this barcode already exists" *(duplicate)*. Nothing
  is posted. Scanning `bc001` finds R1.

### TC-IN-006 Weight 0 or negative is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register R1 with weight 0.
  2. Register R1 with weight −50.
- **Expected:** both refused: "Weight must be greater than 0" *(validation)*. Nothing is posted.

### TC-IN-007 GSM or width 0 is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register R1 with GSM 0 (weight 1000, width 1000).
  2. Register R1 with width 0 (weight 1000, GSM 50).
- **Expected:** step 1: "GSM must be greater than 0". Step 2: "Width must be greater than 0"
  *(validation)*. Nothing is posted.

### TC-IN-008 Missing lot is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register R1 with every field except the lot.
- **Expected:** refused: "Select the lot (challan or invoice) this roll came in on"
  *(validation)*. Nothing is posted.

### TC-IN-009 Missing roll number is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register a roll with every field valid and roll no blank (or only spaces).
- **Expected:** refused: "Roll number is required" *(validation)*. Nothing is posted.

### TC-IN-010 Unknown, missing or inactive material is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1. A second material "Old paper" exists, deactivated, with no rolls.
- **Steps:**
  1. Register R1 with no material.
  2. Register R1 with material `NOPE` (does not exist).
  3. Register R1 with material Old paper.
- **Expected:** steps 1–2: "That material no longer exists — pick another". Step 3:
  "Old paper is inactive — reactivate it before booking stock against it" *(validation)*.
  Nothing is posted.
- **Note:** today a *missing* material gets the same "no longer exists" wording as an unknown
  one. The tablet always sends one, so only an automated test sees this.

### TC-IN-011 Unknown, missing or inactive vendor is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1. A vendor "OLDMILL" exists, deactivated, with no rolls.
- **Steps:**
  1. Register R1 with no vendor.
  2. Register R1 with vendor `NOPE`.
  3. Register R1 with vendor OLDMILL.
- **Expected:** steps 1–2: "That vendor no longer exists — pick another". Step 3:
  "OLDMILL is inactive — pick a different vendor" *(validation)*. Nothing is posted.

### TC-IN-012 Unknown lot is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register R1 with lot `CH-999` (does not exist).
- **Expected:** refused: "That lot no longer exists — pick another" *(validation)*. Nothing is
  posted.

### TC-IN-013 Design must be one of the vendor's papers
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1. ARIHANT's paper list: RT 501 / Delta 730N, RT 502.
- **Steps:**
  1. Register R1 with RT code `999`.
  2. Register R1 with no RT code and Delta code `999X`.
  3. Register R1 with no RT code and Delta code `730n`.
- **Expected:** step 1: "Paper RT 999 is not one of ARIHANT's papers". Step 2:
  "Paper Delta 999X is not one of ARIHANT's papers" *(validation)*. Nothing is posted for
  steps 1–2. Step 3 succeeds: R1 is booked as RT 501 / Delta 730N (found by its Delta code,
  case ignored).
- **Note:** codes are sent without the "RT"/"Delta" prefix (`501`, `730N`). The message adds
  the prefix in front of whatever was typed.

### TC-IN-014 Unknown or inactive godown is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1. Godown B is deactivated.
- **Steps:**
  1. Register R1 with godown `Godown Z` (does not exist).
  2. Register R1 with godown Godown B.
- **Expected:** step 1: "That location no longer exists — pick another". Step 2:
  "Godown B is inactive — pick a different location" *(validation)*. Nothing is posted.

### TC-IN-015 A future date is refused
- **Status:** ✅ today
- **Covers:** AC-01, I-3
- **Layer:** Auto
- **Given:** server today = D5.
- **Steps:**
  1. Register R1, 1000 kg, Godown A, dated D6.
- **Expected:** refused: "The date cannot be in the future" *(validation)*. Nothing is posted.
  Reports for D5 and D6 show Received 0.
- **Note:** today the code does **not** check the registration date at all (`rolls.py`
  `_register` stores whatever date is sent). A roll dated D6 is accepted and its Purchase
  Receipt is dated D6, unless ERPNext itself refuses a future posting. Movements already have
  this check (`dates.check_not_future`). Registration needs it too.

### TC-IN-016 A date older than yesterday is refused
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** server today = D5.
- **Steps:**
  1. Register R1, 1000 kg, dated D3.
- **Expected:** refused: "The date must be today or yesterday" *(validation)*. Nothing is
  posted. D3 report unchanged.
- **Note:** today the code accepts any past date at registration (no date check), so the
  D3 report changes after the fact. The today-or-yesterday rule exists only for
  OUT / RETURN / CONSUME / RETURN_TO_VENDOR / SELL.

### TC-IN-017 Yesterday's date is accepted and lands on yesterday
- **Status:** ✅ today
- **Covers:** AC-01, I-2
- **Layer:** Both
- **Given:** server today = D5.
- **Steps:**
  1. Operator registers R1, 1000 kg, Godown A, date D4 (yesterday), and syncs.
- **Expected:** R1 In stock, 1000, Godown A. History row `Received 1000 kg` dated D4. Purchase
  Receipt posted on D4. Report D4: Received 1000, Closing 1000. Report D5: Opening 1000,
  Received 0, Closing 1000.

### TC-IN-018 Optional fields left blank: barcode, godown, design
- **Status:** ✅ today
- **Covers:** AC-01
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register R1 with lot, vendor, material, GSM, width, 1000 kg, and **no** barcode, godown
     or design.
- **Expected (today's behaviour, for business to confirm):** accepted. R1 In stock, 1000 kg,
  godown empty. ERPNext receipt goes to the hidden warehouse "Unassigned - RT". Received 1000
  in the Base paper report. In the design report it falls under a blank design.
- **Note:** the acceptance document lists barcode, godown and design for every roll but does
  not say they are mandatory. Today only lot, weight, GSM, width, material, vendor and roll
  number are required. A roll with no godown later returns from the floor to Running Godown
  (see TC-RET-010).

### TC-IN-019 Remark codes picked at registration are kept
- **Status:** ✅ today
- **Covers:** AC-01, AC-02, I-6
- **Layer:** Both
- **Given:** D1.
- **Steps:**
  1. Operator registers R1 (as TC-IN-001) picking remark code MISPRINT and typing the note
     "wet corner".
  2. Operator syncs. Supervisor opens R1.
- **Expected:** R1 shows remark Misprint and the note "wet corner". The daily roll report D1
  for R1 shows Remarks "Misprint" and Roll note "wet corner". Kg unchanged: 1000.
- **Note:** today `register_roll` silently drops `remark_code` and `remarks` (Node kept both).
  The report code expects a registration remark, but the loader always passes none. Today
  the only way to put a remark on a roll is the separate "set remark codes" call (TC-RM-001),
  which the offline sync does not carry.

### TC-IN-020 A retried registration returns the same roll, not "already exists"
- **Status:** ✅ today
- **Covers:** AC-01, E-1, I-1
- **Layer:** Auto
- **Given:** D1.
- **Steps:**
  1. Register R1 (1000 kg, Godown A) with client_id `C-1`.
  2. Send the identical registration again with client_id `C-1` (network retry).
- **Expected:** step 2 succeeds and returns the same roll as step 1. One roll, one Purchase
  Receipt, one `Received 1000 kg` row. Reports D1: Received 1000 (not 2000).

---

## Remarks (AC-02)

### TC-RM-001 Remark codes on the roll change nothing else
- **Status:** ✅ today
- **Covers:** AC-02, I-1, I-6
- **Layer:** Both
- **Given:** D1. R1 In stock, 1000 kg, Godown A.
- **Steps:**
  1. Supervisor sets R1's remark codes to MISPRINT and COLOR-VAR.
- **Expected:** R1 shows remarks Misprint and Colour variation. Kg 1000, status In stock,
  Godown A unchanged. **No** new history row, **no** ERPNext document. Reports D1 unchanged
  (Received 1000, Closing 1000, Adjusted 0).
- **Note:** remarks on the roll keep no history. The daily roll report prints the roll's
  *current* remarks on every past day the roll moved, so a remark added on D5 also appears
  on the D1 row of a report re-run later. Business to confirm that this is acceptable for I-6.

### TC-RM-002 Remarks on the roll and on movements, through outward and return
- **Status:** ✅ today
- **Covers:** AC-02, AC-03, I-2, I-6
- **Layer:** Both
- **Given:** D1: R1 registered, 1000 kg, Godown A, design RT 501.
- **Steps:**
  1. D1, supervisor adds remark code MISPRINT to R1.
  2. D2, operator records outward of R1 to Running Godown with note "edge torn".
  3. D2, operator records the return of R1 at 700 kg with remark code COLOR-VAR.
  4. Supervisor opens R1, its history, the D2 daily roll report and its CSV, and the D2
     consumption detail CSV.
- **Expected:**
  - R1: In stock, current 700, Godown A. Remark Misprint on the roll.
  - History: `Received 1000 kg` (D1); `Issued out 1000 kg to Running Godown` with note
    "edge torn" (D2); `Returned 700 kg to Godown A · 300 kg used` with remark COLOR-VAR (D2).
  - ERPNext D2: Material Transfer 1000 Godown A → Running Godown; Material Issue 300 from
    Running Godown; Material Transfer 700 Running Godown → Godown A.
  - Reports D2: Consumed 300, Closing 700, Out on floor 0. Remarks never change kg.
  - Daily roll report D2 (screen = CSV): R1, Movements that day 2, Last movement "Inward",
    Weight moved 700, Weight used 300, Final weight 700, Remarks "Misprint, Colour variation".
  - Consumption detail D2: R1 Consumed 300, Left on roll 700.
- **Note:** the daily roll report has one row per roll per day and shows only the **last**
  movement's note. The outward note "edge torn" is on the history row but not in the D2
  daily report, because the return came after it the same day. The acceptance document asks
  for remarks "in the daily roll report". Confirm one row per day is enough.

### TC-RM-003 An unknown remark code on the roll is refused
- **Status:** ✅ today
- **Covers:** AC-02
- **Layer:** Auto
- **Given:** D1. R1 In stock, 1000 kg, remark MISPRINT.
- **Steps:**
  1. Set R1's remark codes to MISPRINT and `NOPE` (not in the remark master).
- **Expected:** refused: "One or more remarks don't exist" *(validation)*. R1 keeps only
  MISPRINT. Nothing else changes.

### TC-RM-004 An unknown remark code on a movement is refused
- **Status:** ✅ today
- **Covers:** AC-02
- **Layer:** Auto
- **Given:** D1. R1 In stock, 1000 kg, Godown A.
- **Steps:**
  1. Record outward of R1 to Running Godown with remark code `NOPE`.
- **Expected:** refused with a message naming the unknown remark. Nothing is posted. R1 stays
  In stock in Godown A.
- **Note:** today the code accepts it. A movement's remark code is free text (a Data field,
  not checked against the remark master, same as Node). The outward goes through, and the
  daily roll report prints `NOPE` as typed. No refusal message exists yet.

### TC-RM-005 More than 20 remark codes on a roll is refused
- **Status:** ✅ today
- **Covers:** AC-02
- **Layer:** Auto
- **Given:** D1. R1 In stock. 21 remark codes exist in the master.
- **Steps:**
  1. Set R1's remark codes to all 21.
- **Expected:** refused: "Too many remark codes" *(validation)*. R1's remarks unchanged.

### TC-RM-006 Clearing a roll's remark codes
- **Status:** ✅ today
- **Covers:** AC-02
- **Layer:** Auto
- **Given:** D1. R1 with remarks MISPRINT, COLOR-VAR.
- **Steps:**
  1. Set R1's remark codes to an empty list.
- **Expected:** R1 has no remarks. Kg, status, godown, history and ERPNext unchanged.

---

## Outward to the production floor

### TC-OUT-001 Outward a roll to Running Godown
- **Status:** ✅ today
- **Covers:** AC-03, I-1, I-2, I-6
- **Layer:** Both
- **Given:** D1: R1 registered 1000 kg, Godown A, RT 501.
- **Steps:**
  1. D2, operator scans R1, chooses Running Godown, issued to "Machine 3", and syncs.
- **Expected:**
  - R1: status **Out**, current 1000 (a roll goes out whole), Running Godown.
  - History row `Issued out 1000 kg to Running Godown`, dated D2, issued to Machine 3.
  - ERPNext: Stock Entry **Material Transfer** 1000 kg, Godown A → Running Godown, dated D2.
  - Reports D2: Received 0, Consumed 0, Closing 1000, Out on floor 1000.
  - Daily roll report D2: Last movement "Outward", Weight moved 1000, Final status "Out",
    Last location Running Godown, Issued to Machine 3.
- **Note:** this is outward without weighing. Weighing at outward and store loss are AC-09 🆕,
  in their own section.

### TC-OUT-002 Outward without a destination is refused
- **Status:** ✅ today
- **Covers:** AC-03
- **Layer:** Auto
- **Given:** D1. R1 In stock, 1000 kg, Godown A.
- **Steps:**
  1. Record outward of R1 with no location.
- **Expected:** refused: "Where is the roll going? location is required" *(validation)*.
  Nothing is posted.

### TC-OUT-003 Outward of a roll that is already out is refused
- **Status:** ✅ today
- **Covers:** AC-03, E-2
- **Layer:** Both
- **Given:** D1. R1 Out, 1000 kg, Running Godown.
- **Steps:**
  1. Operator records outward of R1 to Running Godown again.
- **Expected:** refused: "This roll is already out — record its return first" *(conflict)*.
  Nothing is posted. Out on floor stays 1000.

### TC-OUT-004 Outward of an empty (finished) roll is refused
- **Status:** ✅ today
- **Covers:** AC-03, I-4
- **Layer:** Auto
- **Given:** D1. R1 Consumed (0 kg, no godown). R2 Returned to vendor (0 kg, no godown).
- **Steps:**
  1. Record outward of R1 to Running Godown.
  2. Record outward of R2 to Running Godown.
- **Expected:** both refused: "This roll is empty, there is nothing to take out" *(conflict)*.
  Nothing is posted.

### TC-OUT-005 Outward of a sold roll is refused
- **Status:** ✅ today
- **Covers:** AC-05
- **Layer:** Auto
- **Given:** D1. R1 Sold.
- **Steps:**
  1. Record outward of R1 to Running Godown.
- **Expected:** refused: "This roll has already been sold" *(conflict)*. Nothing is posted.

### TC-OUT-006 Outward to an unknown or inactive godown is refused
- **Status:** ✅ today
- **Covers:** AC-03
- **Layer:** Auto
- **Given:** D1. R1 In stock, 1000 kg, Godown A. A second floor godown "Running Godown 2"
  is deactivated.
- **Steps:**
  1. Record outward of R1 to `Godown Z` (does not exist).
  2. Record outward of R1 to Running Godown 2.
- **Expected:** step 1: "That location no longer exists — pick another". Step 2:
  "Running Godown 2 is inactive — pick a different location" *(validation)*. Nothing is
  posted. R1 stays In stock in Godown A.

### TC-OUT-007 Outward of an unknown roll is refused
- **Status:** ✅ today
- **Covers:** AC-03
- **Layer:** Auto
- **Given:** D1. No roll with barcode BC999.
- **Steps:**
  1. Record outward of `BC999` to Running Godown.
- **Expected:** refused: "Roll not found" *(not_found)*. Nothing is posted.

### TC-OUT-008 Movement date rules: yesterday allowed, older or future refused
- **Status:** ✅ today
- **Covers:** AC-03, T-4
- **Layer:** Auto
- **Given:** server today = D5. R1 registered D1, 1000 kg, Godown A. R2 likewise.
- **Steps:**
  1. Record outward of R1 to Running Godown dated D4 (yesterday).
  2. Record outward of R2 dated D3.
  3. Record outward of R2 dated D6.
  4. Record outward of R2 dated D5 with saved-on time (`recorded_at`) D6.
- **Expected:** step 1 accepted: R1 Out, history row dated D4, report D4 Out on floor 1000.
  Step 2: "The date must be today or yesterday". Step 3: "The date cannot be in the future".
  Step 4: "The saved-on time cannot be in the future" *(validation)*. Nothing is posted for
  R2, which stays In stock in Godown A.
- **Note:** the same rule applies to return, consume, return to vendor and sale. Adjustment and
  inward top-up only refuse a future date (any past date is accepted). See TC-ADJ-007.

### TC-OUT-009 Up to 4 photos on a movement; a fifth is refused
- **Status:** ✅ today
- **Covers:** AC-03
- **Layer:** Auto
- **Given:** D1. R1 and R2 In stock, Godown A. Five photos uploaded.
- **Steps:**
  1. Record outward of R1 with 4 photos.
  2. Record outward of R2 with 5 photos.
- **Expected:** step 1 accepted, the history row lists the 4 photos. Step 2 refused:
  "At most 4 photos per movement" *(validation)*. Nothing is posted for R2.

### TC-OUT-010 Outward to a storage godown (not the floor)
- **Status:** ✅ today
- **Covers:** AC-03, AC-06
- **Layer:** Auto
- **Given:** D1. R1 In stock, 1000 kg, Godown A.
- **Steps:**
  1. Record outward of R1 with location Godown B.
- **Expected (today's behaviour, for business to confirm):** accepted. R1 status **Out**,
  1000 kg, Godown B. Material Transfer A → B. Out on floor 1000.
- **Note:** the code does not check that an outward goes to a floor godown. Moving between
  storage godowns is meant to be a portal edit (AC-06), which keeps the roll In stock. Decide
  whether an outward to a storage godown should be refused.

---

## Return from the floor (AC-03, AC-07a)

### TC-RET-001 Return with part of the roll used
- **Status:** ✅ today
- **Covers:** AC-07a, I-1, I-2, I-6
- **Layer:** Both
- **Given:** D1: R1 registered 1000 kg, Godown A, RT 501. D2: R1 out to Running Godown.
- **Steps:**
  1. D2, operator scans R1, enters returned weight 600, and syncs.
- **Expected:**
  - R1: **In stock**, arrival 1000, current 600, **Godown A** (the godown it went out from).
  - History row `Returned 600 kg to Godown A · 400 kg used`.
  - ERPNext: Stock Entry **Material Issue** 400 from Running Godown, and **Material Transfer**
    600 Running Godown → Godown A.
  - Reports D2: Consumed 400, Closing 600, Out on floor 0.
  - Daily roll report D2: Last movement "Inward", Weight moved 600, Weight used 400.
    Consumption detail: Consumed 400, Left on roll 600.

### TC-RET-002 Inward and outward on different days (AC-03 timeline)
- **Status:** ✅ today
- **Covers:** AC-03, I-2, I-5
- **Layer:** Auto
- **Given:** empty stock.
- **Steps:**
  1. D1, register R1 1000 kg, Godown A, RT 501.
  2. D4, outward R1 to Running Godown.
  3. D6, return R1 at 600 kg.
  4. Check every day D1–D7, then the weekly report D1–D7.
- **Expected:**

  | Day | Roll | Received | Consumed | Closing | Out on floor |
  |---|---|---|---|---|---|
  | D1 | In stock, 1000, Godown A | 1000 | 0 | 1000 | 0 |
  | D2–D3 | unchanged | 0 | 0 | 1000 | 0 |
  | D4 | Out, 1000, Running Godown | 0 | 0 | 1000 | 1000 |
  | D5 | unchanged | 0 | 0 | 1000 | 1000 |
  | D6 | In stock, 600, Godown A | 0 | **400** | 600 | 0 |
  | D7 | unchanged | 0 | 0 | 600 | 0 |

  Consumption counts on the **return day** (D6). Weekly D1–D7: Received 1000, Consumed 400,
  Closing 600. Same figures for Base paper and RT 501.

### TC-RET-003 Return with nothing used
- **Status:** ✅ today
- **Covers:** AC-07a, I-2
- **Layer:** Both
- **Given:** D1: R1 1000 kg, Godown A, out to Running Godown.
- **Steps:**
  1. D1, operator returns R1 at 1000 kg.
- **Expected:** R1 In stock, 1000, Godown A. History `Returned 1000 kg to Godown A · 0 kg used`.
  ERPNext: only a Material Transfer 1000 Running Godown → Godown A, **no** Material Issue.
  Reports D1: Received 1000, Consumed 0, Closing 1000, Out on floor 0.

### TC-RET-004 Return at 0 kg: fully used, the roll is finished
- **Status:** ✅ today
- **Covers:** AC-07a, I-4
- **Layer:** Both
- **Given:** D1: R1 1000 kg, Godown A. D2: out to Running Godown.
- **Steps:**
  1. D2, operator returns R1 at 0 kg.
- **Expected:** R1 **Consumed**, current 0, **no godown**. History `Returned 0 kg · 1000 kg used`.
  ERPNext: Material Issue 1000 from Running Godown, no transfer. Reports D2: Consumed 1000,
  Closing 0, Out on floor 0. Daily roll report D2: Final status "Consumed", Final weight 0.

### TC-RET-005 Coming back heavier than it went out is refused
- **Status:** ✅ today
- **Covers:** AC-07a
- **Layer:** Both
- **Given:** D1: R1 1000 kg, out to Running Godown.
- **Steps:**
  1. Operator returns R1 at 1001 kg.
- **Expected:** refused: "This roll went out with 1000 kg — it cannot come back heavier at 1001"
  *(validation)*. Nothing is posted. R1 stays Out, 1000, Running Godown.

### TC-RET-006 Return of a roll that is not out is refused
- **Status:** ✅ today
- **Covers:** AC-07a, T-6
- **Layer:** Auto
- **Given:** D1. R1 In stock 1000 kg, Godown A. R2 Consumed. R3 Returned to vendor. R4 Sold.
- **Steps:**
  1. Return R1 at 500.
  2. Return R2 at 0.
  3. Return R3 at 0.
  4. Return R4 at 0.
- **Expected:** steps 1–3: "This roll is not currently out, so it cannot be returned". Step 4:
  "This roll has already been sold" *(conflict)*. Nothing is posted.

### TC-RET-007 Missing or negative returned weight is refused
- **Status:** ✅ today
- **Covers:** AC-07a
- **Layer:** Auto
- **Given:** D1. R1 Out, 1000 kg.
- **Steps:**
  1. Return R1 with no returned weight.
  2. Return R1 with returned weight −10.
- **Expected:** step 1: "RETURN requires returned_weight — what the roll weighs coming back".
  Step 2: "returned_weight cannot be negative" *(validation)*. Nothing is posted.

### TC-RET-008 A roll returns to the godown of its latest outward
- **Status:** ✅ today
- **Covers:** AC-03, AC-06, I-1
- **Layer:** Both
- **Given:** D1: R1 1000 kg, Godown A. D1: out, returned at 800 (back in Godown A).
  D2: supervisor moves R1 to Godown B on the portal (AC-06).
- **Steps:**
  1. D3, outward R1 to Running Godown.
  2. D3, return R1 at 500.
- **Expected:** R1 In stock, 500, **Godown B** (the latest outward's source, not Godown A).
  History `Returned 500 kg to Godown B · 300 kg used`. ERPNext D3: Material Issue 300 from
  Running Godown, Material Transfer 500 Running Godown → Godown B. Reports D3: Consumed 300,
  Closing 500.

### TC-RET-009 The godown was retired while the roll was out
- **Status:** ✅ today
- **Covers:** AC-07a, I-1
- **Layer:** Auto
- **Given:** D1: Godown C (storage) exists. R1 1000 kg registered in Godown C, then out to
  Running Godown. Then Godown C is deactivated.
- **Steps:**
  1. D1, return R1 at 800.
- **Expected (today's behaviour, for business to confirm):** accepted. R1 **In stock**, 800,
  stays in **Running Godown**. History `Returned 800 kg · 200 kg used` (no godown named).
  ERPNext: Material Issue 200 from Running Godown, no transfer. Consumed 200.
- **Note:** the roll ends "In stock" on the production floor, so the supervisor has to move it to
  a storage godown on the portal (AC-06). It still counts as in store for low-stock purposes.
  Decide whether the return should ask for a godown instead.

### TC-RET-010 Return of a roll registered with no godown
- **Status:** ✅ today
- **Covers:** AC-07a, I-1
- **Layer:** Auto
- **Given:** D1: R1 1000 kg registered with no godown (stock in "Unassigned - RT"), then out
  to Running Godown.
- **Steps:**
  1. D1, return R1 at 700.
- **Expected (today's behaviour):** R1 In stock, 700, **Running Godown**. History
  `Returned 700 kg · 300 kg used`. Material Issue 300 from Running Godown. Consumed 300.
- **Note:** same outcome as TC-RET-009: an In-stock roll sitting on the floor. This follows
  from TC-IN-018 (godown optional at registration).

### TC-RET-011 A return dated before its outward
- **Status:** ✅ today
- **Covers:** AC-03, I-2, T-4
- **Layer:** Auto
- **Given:** server today = D5. R1 registered D4, 1000 kg, Godown A. Outward recorded D5
  (today).
- **Steps:**
  1. Record the return of R1 at 800 dated D4 (yesterday).
- **Expected (today's behaviour, for business to confirm):** accepted. R1 In stock, 800,
  Godown A. Report D4: Received 1000, Consumed 200, Closing 800. Report D5: Consumed 0,
  Closing 800, Out on floor 0. The ledger stays consistent (I-1).
- **Note:** the consumption is reported on D4, the day **before** the roll went out. The rule
  only checks "today or yesterday" and the roll's current status, not that the return comes
  after its outward. Business to decide whether this should be refused.

---

## Return to vendor, whole roll (AC-04)

### TC-RTV-001 Return a whole roll to the vendor from stock
- **Status:** ✅ today
- **Covers:** AC-04, I-2, I-4
- **Layer:** Both
- **Given:** D1: R2 registered 500 kg, Godown A, RT 501.
- **Steps:**
  1. D3, operator scans R2, chooses Return to vendor, and syncs.
- **Expected:**
  - R2: **Returned to vendor**, current 0, no godown.
  - History row `Returned to vendor ARIHANT — 500 kg`, dated D3.
  - ERPNext: a submitted **Purchase Return** (return Purchase Receipt against R2's receipt),
    −500 kg from Godown A, dated D3.
  - Reports D3: Returned to vendor 500, Closing 0. D1: Received 500, Closing 500.
  - Daily roll report D3: Last movement "Returned to vendor", Final status
    "Returned to vendor", Final weight 0.

### TC-RTV-002 Return to vendor after part of the roll was used
- **Status:** ✅ today
- **Covers:** AC-04, AC-07a, I-2
- **Layer:** Auto
- **Given:** D1: R1 1000 kg, Godown A. D2: out, returned at 600 (Consumed 400 on D2).
- **Steps:**
  1. D3, return R1 to vendor.
- **Expected:** R1 Returned to vendor, 0, no godown. History
  `Returned to vendor ARIHANT — 600 kg`. Purchase Return −600 from Godown A. Reports D3:
  Returned to vendor 600, Closing 0. D2 unchanged (Consumed 400).

### TC-RTV-003 Return to vendor while the roll is out is refused
- **Status:** ✅ today
- **Covers:** AC-04
- **Layer:** Both
- **Given:** D1: R2 500 kg, out to Running Godown.
- **Steps:**
  1. Operator chooses Return to vendor for R2.
- **Expected:** refused: "This roll is already out — record its return first" *(conflict)*.
  Nothing is posted. R2 stays Out, 500, Running Godown.

### TC-RTV-004 Return to vendor of a consumed roll is refused
- **Status:** ✅ today
- **Covers:** AC-04
- **Layer:** Auto
- **Given:** D1: R2 Consumed (returned at 0).
- **Steps:**
  1. Return R2 to vendor.
- **Expected:** refused: "This roll is already consumed — there is nothing left to return"
  *(conflict)*. Nothing is posted.

### TC-RTV-005 Returning to the vendor twice is refused
- **Status:** ✅ today
- **Covers:** AC-04
- **Layer:** Auto
- **Given:** D3: R2 already Returned to vendor.
- **Steps:**
  1. Return R2 to vendor again.
- **Expected:** refused: "This roll has already been returned to the vendor" *(conflict)*.
  Nothing is posted. Only one Purchase Return exists.

### TC-RTV-006 Return to vendor of a sold roll is refused
- **Status:** ✅ today
- **Covers:** AC-04, AC-05
- **Layer:** Auto
- **Given:** D1: R2 Sold.
- **Steps:**
  1. Return R2 to vendor.
- **Expected:** refused: "This roll has already been sold" *(conflict)*. Nothing is posted.

---

## Sale, whole roll (AC-05)

### TC-SELL-001 Sell a whole roll to Direct Sale with bill and vehicle numbers
- **Status:** ✅ today
- **Covers:** AC-05, I-2, I-4
- **Layer:** Both
- **Given:** D1: R3 registered 800 kg, Godown A, RT 502.
- **Steps:**
  1. D5, operator chooses Sell for R3 with **no buyer picked**, Savio bill no ` SB-123 `,
     vehicle no ` mh12 ab 1234 `, and syncs.
- **Expected:**
  - R3: **Sold**, current 0, no godown.
  - History row `Sold — 800 kg`, buyer Direct Sale, Savio bill no `SB-123`, vehicle no
    `MH12 AB 1234` (trimmed, upper-cased).
  - ERPNext: a submitted **Delivery Note** to customer Direct Sale, 800 kg, batch R3, from
    Godown A, dated D5.
  - Reports D5 (Base paper and RT 502): Sold 800, Closing 0.
- **Note:** today the bill no and vehicle no are kept on the roll's sale movement (portal history),
  **not** on the ERPNext Delivery Note. The acceptance document says "Delivery Note … bill no
  and vehicle no kept". Confirm whether the movement record is enough.

### TC-SELL-002 Sell to a named buyer
- **Status:** ✅ today
- **Covers:** AC-05
- **Layer:** Auto
- **Given:** D1: R3 800 kg, Godown A.
- **Steps:**
  1. Sell R3 to Kumar Traders.
- **Expected:** R3 Sold, 0. Delivery Note to Kumar Traders, 800 kg. History `Sold — 800 kg`,
  buyer Kumar Traders. Sold 800.

### TC-SELL-003 Sell what is left of a used roll
- **Status:** ✅ today
- **Covers:** AC-08a, I-2
- **Layer:** Both
- **Given:** D1: R1 1000 kg, Godown A. D2: out, returned at 600.
- **Steps:**
  1. D3, operator sells R1 to Direct Sale.
- **Expected:** R1 Sold, 0, no godown. History `Sold — 600 kg`. Delivery Note 600 kg from
  Godown A. Reports D3: Sold 600, Closing 0. Totals D1–D3: Received 1000, Consumed 400,
  Sold 600, Closing 0.

### TC-SELL-004 Godown roles never see the sale price
- **Status:** ✅ today
- **Covers:** AC-05, E-8
- **Layer:** Both
- **Given:** D1: R3 800 kg, Godown A.
- **Steps:**
  1. Admin records the sale of R3 to Direct Sale at 40,000 for the roll.
  2. Supervisor (Godown Supervisor) opens R3's history on the portal.
  3. Operator looks at R3 on the tablet.
  4. Admin opens R3's history.
- **Expected:** steps 2–3: the sale row shows no price, and the API response for the movement has
  no `rate_per_roll` field. Step 4: admin sees 40,000. ERPNext Delivery Note line: 800 kg at
  50 per kg (40,000 total). Godown roles cannot read the rate through ERPNext's rate lookups
  either ("You do not have permission to perform this action").

### TC-SELL-005 Sale while the roll is out is refused
- **Status:** ✅ today
- **Covers:** AC-05
- **Layer:** Both
- **Given:** D1: R3 800 kg, out to Running Godown.
- **Steps:**
  1. Operator chooses Sell for R3.
- **Expected:** refused: "This roll is out on production — receive it back before selling it"
  *(conflict)*. Nothing is posted.

### TC-SELL-006 Sale of a consumed or returned roll is refused
- **Status:** ✅ today
- **Covers:** AC-05
- **Layer:** Auto
- **Given:** D1: R1 Consumed. R2 Returned to vendor.
- **Steps:**
  1. Sell R1.
  2. Sell R2.
- **Expected:** step 1: "This roll is already consumed — there is nothing left to sell". Step 2:
  "This roll has already been returned to the vendor" *(conflict)*. Nothing is posted.

### TC-SELL-007 Selling twice is refused
- **Status:** ✅ today
- **Covers:** AC-05
- **Layer:** Auto
- **Given:** D5: R3 Sold.
- **Steps:**
  1. Sell R3 again.
- **Expected:** refused: "This roll has already been sold" *(conflict)*. Nothing is posted. One
  Delivery Note.

### TC-SELL-008 Sale to an unknown buyer is refused
- **Status:** ✅ today
- **Covers:** AC-05
- **Layer:** Auto
- **Given:** D1: R3 800 kg, Godown A.
- **Steps:**
  1. Sell R3 to buyer `Nobody Ltd` (no such customer).
- **Expected:** refused: "That buyer no longer exists — pick another" *(validation)*. Nothing is
  posted.

---

## Consume (finish without a return)

### TC-CON-001 Consume a roll in stock
- **Status:** ✅ today
- **Covers:** I-2, I-4
- **Layer:** Auto
- **Given:** D1: R1 1000 kg, Godown A.
- **Steps:**
  1. D2, record Consume for R1.
- **Expected:** R1 **Consumed**, 0, no godown. History `Consumed — 1000 kg used up`. ERPNext:
  Material Issue 1000 from Godown A. Reports D2: Consumed 1000, Closing 0.

### TC-CON-002 Consume a roll that is out (finished on the floor)
- **Status:** ✅ today
- **Covers:** AC-03, I-2, I-4
- **Layer:** Both
- **Given:** D1: R1 1000 kg, out to Running Godown.
- **Steps:**
  1. D2, operator marks R1 consumed (no return weight).
- **Expected:** R1 Consumed, 0, no godown. History `Consumed — 1000 kg used up`. Material
  Issue 1000 from **Running Godown**. Reports D2: Consumed 1000, Closing 0, Out on floor 0.

### TC-CON-003 Consume a roll that is already finished
- **Status:** ✅ today
- **Covers:** I-4
- **Layer:** Auto
- **Given:** D1: R1 Consumed, R2 Returned to vendor, R3 Sold.
- **Steps:**
  1. Record Consume for R1, then R2, then R3.
- **Expected (today's behaviour, for business to confirm):** each is **accepted** as a no-op.
  The roll is unchanged and **no** ERPNext document is created, but a history row `Consumed`
  (0 kg) is added. Reports unchanged.
- **Note:** a sold or returned roll gains a "Consumed" row in its history, which a reviewer may
  read as a second finish. Decide whether this should be refused instead.

---

## Physical count adjustment (E-5)

### TC-ADJ-001 Count lower than the roll
- **Status:** ✅ today
- **Covers:** E-5, I-1, I-2
- **Layer:** Auto
- **Given:** D1: R1 1000 kg, Godown A.
- **Steps:**
  1. D2, supervisor records an adjustment for R1: counted 950 kg, remarks "physical count".
- **Expected:** R1 In stock, 950, Godown A. History `Corrected by 50 kg` with remarks
  "physical count". ERPNext: Material Issue 50 from Godown A. Reports D2: Adjusted −50,
  Consumed 0, Closing 950.

### TC-ADJ-002 Count higher than the roll (up to arrival)
- **Status:** ✅ today
- **Covers:** E-5, I-2
- **Layer:** Auto
- **Given:** D1: R1 arrival 1000. D2: out, returned at 600 (In stock, Godown A).
- **Steps:**
  1. D3, adjustment: counted 650, remarks "recount".
- **Expected:** R1 In stock, 650. History `Corrected by 50 kg`. ERPNext: Material Receipt 50
  into Godown A. Reports D3: Adjusted +50, Closing 650.
- **Note:** the history text is the same for up and down ("Corrected by 50 kg"), so the row does
  not show the direction. The report sign (+/−) does.

### TC-ADJ-003 Count to 0 finishes the roll
- **Status:** ✅ today
- **Covers:** E-5, I-4
- **Layer:** Auto
- **Given:** D1: R1 1000 kg, Godown A.
- **Steps:**
  1. D2, adjustment: counted 0, remarks "not found in godown".
- **Expected:** R1 **Consumed**, 0, no godown. History `Corrected by 1000 kg`. Material Issue
  1000 from Godown A. Reports D2: **Adjusted −1000** (not Consumed), Closing 0.

### TC-ADJ-004 Count above the arrival weight is refused
- **Status:** ✅ today
- **Covers:** E-5
- **Layer:** Auto
- **Given:** D1: R1 arrival 1000, current 600.
- **Steps:**
  1. Adjustment: counted 1001, remarks "recount".
- **Expected:** refused: "This roll only ever held 1000 kg — the counted amount cannot be higher"
  *(validation)*. Nothing is posted.

### TC-ADJ-005 Remarks and the counted weight are required
- **Status:** ✅ today
- **Covers:** E-5
- **Layer:** Auto
- **Given:** D1: R1 1000 kg.
- **Steps:**
  1. Adjustment: counted 950, no remarks.
  2. Adjustment: counted 950, remarks "   " (only spaces).
  3. Adjustment: no counted weight, remarks "recount".
- **Expected:** steps 1–2: "ADJUSTMENT requires remarks". Step 3: "ADJUSTMENT requires new_weight"
  *(validation)*. Nothing is posted.

### TC-ADJ-006 Adjust a roll that is out on the floor
- **Status:** ✅ today
- **Covers:** E-5, I-1
- **Layer:** Auto
- **Given:** D1: R1 1000 kg, out to Running Godown.
- **Steps:**
  1. Adjustment: counted 900, remarks "recount".
  2. Adjustment: counted 0, remarks "lost on floor".
- **Expected (today's behaviour, for business to confirm):** step 1: R1 stays **Out**, 900,
  Running Godown. Material Issue 100 from Running Godown. Adjusted −100, Out on floor 900.
  Step 2: R1 Consumed, 0, no godown. Adjusted −900.
- **Note:** neither the acceptance document nor the code stops counting a roll while it is on
  the floor.

### TC-ADJ-007 Negative count, and backdating
- **Status:** ✅ today
- **Covers:** E-5, I-3
- **Layer:** Auto
- **Given:** server today = D10. R1 registered D1, 1000 kg, Godown A.
- **Steps:**
  1. Adjustment: counted −10, remarks "typo".
  2. Adjustment dated D2: counted 900, remarks "old count".
  3. Adjustment dated D11: counted 900, remarks "x".
- **Expected:** step 1 is refused and nothing is posted (I-3). Step 3: "The date cannot be in
  the future". Step 2: business to decide whether a count may be dated 8 days back.
- **Note:** today a negative count has **no** rule of its own (the portal correction refuses it,
  the movement API does not), so only ERPNext's negative-stock check can stop it. Adjustments
  (and inward top-ups) accept **any** past date, unlike other movements (today or yesterday),
  so step 2 is accepted today and changes the D2 report.

---

## State-transition matrix

Today's code, for a roll that arrived at 1000 kg. "→" = allowed, with the resulting state.
Quoted text = the exact refusal. ⚠ = allowed today, but conflicts with invariant I-4 or looks
unintended. These cells have their own case below.

| Status ↓ / Action → | Outward | Return | Return to vendor | Sell | Consume | Adjust | Inward top-up |
|---|---|---|---|---|---|---|---|
| **In stock** (1000, Godown A) | → Out, Running Godown (Material Transfer) | "This roll is not currently out, so it cannot be returned" | → Returned to vendor, 0 (Purchase Return) | → Sold, 0 (Delivery Note) | → Consumed, 0 (Material Issue) | → counted kg, 0 ≤ kg ≤ 1000; 0 → Consumed | → + kg up to 1000 (Material Receipt) |
| **Out** (1000, Running Godown) | "This roll is already out — record its return first" | → In stock (or Consumed at 0), back to its godown | "This roll is already out — record its return first" | "This roll is out on production — receive it back before selling it" | → Consumed, 0 (Material Issue from floor) | → stays Out at counted kg; 0 → Consumed | → stays Out, + kg up to 1000 |
| **Consumed** (0) | "This roll is empty, there is nothing to take out" | "This roll is not currently out, so it cannot be returned" | "This roll is already consumed — there is nothing left to return" | "This roll is already consumed — there is nothing left to sell" | no-op: `Consumed` row, nothing posted | ⚠ accepted: stays Consumed holding the kg | ⚠ accepted: back to In stock, no godown |
| **Returned to vendor** (0) | "This roll is empty, there is nothing to take out" | "This roll is not currently out, so it cannot be returned" | "This roll has already been returned to the vendor" | "This roll has already been returned to the vendor" | no-op: `Consumed` row, nothing posted | ⚠ accepted: stays Returned to vendor holding the kg | ⚠ accepted: back to In stock, no godown |
| **Sold** (0) | "This roll has already been sold" | "This roll has already been sold" | "This roll has already been sold" | "This roll has already been sold" | no-op: `Consumed` row, nothing posted | "This roll has already been sold" | ⚠ accepted: back to In stock, no godown |

Limits that apply in every allowed cell: top-up above arrival → "This roll only ever held 1000 kg —
cannot add more than that". Top-up of 0 → "weight is required for IN". Adjust above arrival →
"This roll only ever held 1000 kg — the counted amount cannot be higher".

### TC-STATE-001 Every cell of the matrix
- **Status:** ✅ today
- **Covers:** AC-03, AC-04, AC-05, E-5, I-1, I-4
- **Layer:** Auto
- **Given:** for each row of the matrix, a fresh roll of 1000 kg brought to that status
  (In stock: registered in Godown A. Out: plus an outward. Consumed: out and returned at 0.
  Returned to vendor / Sold: from In stock).
- **Steps:**
  1. For each status × action, attempt the action (return at 600, adjust to 900 with remarks,
     top-up of 50 where the roll holds less than 1000, otherwise of 1).
- **Expected:** each cell gives the result or the exact refusal in the table. Every refusal
  posts nothing. After every allowed action, I-1 holds. The ⚠ cells are covered by
  TC-STATE-003 and TC-STATE-004.

### TC-STATE-002 Inward top-up on a roll in stock
- **Status:** ✅ today
- **Covers:** E-5, I-1, I-2
- **Layer:** Auto
- **Given:** D1: R1 arrival 1000. D2: adjusted to 900 (Godown A).
- **Steps:**
  1. D3, record an inward (IN) of 100 kg on R1.
  2. D3, record an inward of 1 kg on R1.
  3. D3, record an inward of 0 kg on R1.
- **Expected:** step 1: R1 In stock, 1000, Godown A. History `Received 100 kg`. ERPNext: Stock
  Entry Material Receipt 100 into Godown A. Reports D3: **Received 100**, Closing 1000.
  Step 2: "This roll only ever held 1000 kg — cannot add more than that". Step 3:
  "weight is required for IN" *(validation)*. Nothing is posted for steps 2–3.
- **Note:** a top-up counts as **Received** in the reports, the same column as a new roll.
  A reviewer may expect it under Adjusted.

### TC-STATE-003 Adjusting a finished roll is refused
- **Status:** ✅ today
- **Covers:** E-5, I-4
- **Layer:** Auto
- **Given:** D1: R1 Consumed (returned at 0). R2 Returned to vendor.
- **Steps:**
  1. Adjustment on R1: counted 100, remarks "found it".
  2. Adjustment on R2: counted 100, remarks "found it".
- **Expected:** both refused (I-4: a finished roll holds 0 kg), with the wording the portal
  correction already uses: "This roll is finished, so its remaining weight can no longer be
  corrected". Nothing is posted.
- **Note:** today both are **accepted**. R1 stays "Consumed" but holds 100 kg (Material Receipt
  of 100 into the hidden "Unassigned - RT" warehouse), and the same for R2. This breaks I-4.
  The portal correction screen refuses this, but the movement API and the tablet's sync do not.

### TC-STATE-004 Inward top-up of a finished roll
- **Status:** ✅ today
- **Covers:** I-4
- **Layer:** Auto
- **Given:** D1: R1 Consumed, R2 Returned to vendor, R3 Sold (each arrived at 1000).
- **Steps:**
  1. Record an inward of 100 kg on R1, R2 and R3.
- **Expected:** refused (a finished roll stays finished, I-4. A roll back from a customer or
  vendor should be registered as a new roll). Nothing is posted.
- **Note:** today all three are **accepted**. Each roll goes back to **In stock** with 100 kg and
  **no godown** (stock lands in "Unassigned - RT"), and the report shows Received 100. For R3
  this happens even though every other action on a sold roll is refused with "This roll has
  already been sold".

### TC-STATE-005 A sold roll refuses every action except consume and top-up
- **Status:** ✅ today
- **Covers:** AC-05, I-4
- **Layer:** Auto
- **Given:** D1: R3 Sold.
- **Steps:**
  1. Attempt outward, return (0), return to vendor, sell and adjust (counted 0, remarks "x").
- **Expected:** each refused: "This roll has already been sold" *(conflict)*. Nothing is posted.
  The check comes before any other rule, so even a return of 0 gets this message rather than
  "not currently out".
