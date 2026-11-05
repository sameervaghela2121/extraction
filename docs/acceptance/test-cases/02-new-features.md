# Test cases 02 — New features: partial returns and sales, store loss, minimum stock, alerts, godown move

Authority: `docs/acceptance/2026-11-04-inventory-acceptance.md` (AC-06, AC-07b, AC-08b, AC-09, AC-10,
Alerts page). Where these cases need a value the acceptance doc does not settle, the case says 🔶 and
the question is listed at the end.

Status: ✅ works today · 🆕 to build · 🔶 value to confirm.
Layer: **Auto** = timeline test (backend, controlled clock, I-1…I-6 checked after every step) ·
**Manual** = tablet + portal pass · **Both**.

**Conventions for this section**

- Each case starts from the shared setup only (Godown A, Godown B, Running Godown; Base paper;
  ARIHANT with RT 501 / Delta 730N and RT 502; operator, supervisor, admin) plus the rolls it lists.
  No other stock of the design exists unless the case says so.
- R4–R9 are the golden-dataset rolls and follow their golden story. Extra rolls are local to this
  section: R21–R29 (partial return / sale), R31–R39 (store loss), R41–R49 (minimum stock),
  R51–R59 (godown move). All are Base paper on a lot from ARIHANT.
- "Reports D3" means the daily report for D3, **both** by material (Base paper) and by design
  (RT 501 or RT 502). Only non-zero figures are listed; every figure not listed is 0. Figures:
  Opening · Received · Consumed · Returned to vendor · Sold · Adjusted · Store loss · Closing ·
  Out on floor.
- "Nothing is posted" means: no history row, no ERPNext document, roll unchanged, reports unchanged,
  no alert raised or changed, I-1 still holds.
- Messages marked "(proposed)" are new wording for a 🆕 feature, for the business to approve.
  Unmarked messages are today's wording.
- "Outward weighed N kg" means the operator weighs the roll on the outward screen (scale reading
  or typed, with a scale photo), as the tablet does today.
- Where a partial return / sale amount is entered and whether it is weighed is not yet decided
  (see open questions); cases say "enters 300 kg" for both.

---

## Partial return to vendor (AC-07b)

### TC-PRTV-001 Return part of a roll to the vendor
- **Status:** 🆕 to build
- **Covers:** AC-07b; I-1, I-2
- **Layer:** Both
- **Given:** R5 (RT 501) inward D1, 1000 kg, Godown A, In stock.
- **Steps:**
  1. D3, operator on tablet: scans R5 → Send to vendor → enters 300 kg → remark code (as today) → photo → confirm.
  2. Tablet syncs.
- **Expected:**
  - R5: **In stock**, current 700 kg, Godown A, arrival 1000.
  - History: 2 rows — "Received 1000 kg" (D1), "Returned 300 kg to vendor" (D3).
  - ERPNext: one submitted Purchase Return (return against R5's Purchase Receipt) for 300 kg of
    R5's batch from Godown A, dated D3. Batch balance in Godown A = 700 (I-1).
  - Reports D1: Received 1000, Closing 1000.
  - Reports D3: Opening 1000, Returned to vendor 300, Closing 700.
  - Daily roll report and CSV for D3 list R5 with the 300 kg return (I-6).

### TC-PRTV-002 Returning exactly what is left finishes the roll
- **Status:** 🆕 to build
- **Covers:** AC-07b; I-4
- **Layer:** Both
- **Given:** R5 after TC-PRTV-001: In stock, 700 kg, Godown A.
- **Steps:**
  1. D5, operator on tablet: Send to vendor → enters 700 kg → confirm. Sync.
- **Expected:**
  - R5: **Returned to vendor**, 0 kg, no godown (I-4).
  - History: 3 rows; the new one "Returned 700 kg to vendor" (D5).
  - ERPNext: a second Purchase Return for 700 kg, dated D5. Total returned against R5's receipt =
    1000 = received. Batch balance 0.
  - Reports D5: Opening 700, Returned to vendor 700, Closing 0.
  - Weekly report D1–D7: Received 1000, Returned to vendor 1000, Closing 0 (I-5).
  - R5 no longer offers Send to vendor / Sell / Outward on the tablet.

### TC-PRTV-003 Whole-roll "Send to vendor" after a partial returns only what is left
- **Status:** 🆕 to build (whole-roll action ✅ today; this checks it after a partial)
- **Covers:** AC-04, AC-07b
- **Layer:** Auto
- **Given:** R21 (RT 501) inward D1 1000 kg, Godown A; D2 partial return to vendor 400 → In stock 600.
- **Steps:**
  1. D3, operator on tablet: Send to vendor **without** entering kg (whole roll, as today). Sync.
- **Expected:**
  - R21: Returned to vendor, 0 kg, no godown.
  - History row "Returned to vendor ARIHANT — 600 kg" (today's wording for a whole-roll return).
  - ERPNext: Purchase Return for **600** (not 1000). Total returned against the receipt = 1000.
  - Reports D3: Opening 600, Returned to vendor 600, Closing 0.

### TC-PRTV-004 Several partial returns, two on the same day
- **Status:** 🆕 to build
- **Covers:** AC-07b; I-2, I-5, I-6
- **Layer:** Auto
- **Given:** R22 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2 10:00, operator: partial return to vendor 100 kg.
  2. D2 15:00, operator: partial return to vendor 150 kg.
  3. D4, operator: partial return to vendor 200 kg.
- **Expected:**
  - R22: In stock, 550 kg, Godown A.
  - History: 4 rows — Received 1000; Returned 100 kg to vendor; Returned 150 kg to vendor; Returned 200 kg to vendor.
  - ERPNext: 3 Purchase Returns (100, 150, 200), each its own document with its own date.

  | Day | R22 kg | Received | Returned to vendor | Closing |
  |---|---|---|---|---|
  | D1 | 1000 | 1000 | 0 | 1000 |
  | D2 | 750 | 0 | **250** | 750 |
  | D3 | 750 | 0 | 0 | 750 |
  | D4 | 550 | 0 | 200 | 550 |

  - Weekly D1–D7: Received 1000, Returned to vendor 450, Closing 550 (= sum of days, I-5).
  - D2 daily roll report shows both D2 rows.

### TC-PRTV-005 Refused: more kg than the roll holds
- **Status:** 🆕 to build
- **Covers:** AC-07b (must be refused)
- **Layer:** Both
- **Given:** R5 after TC-PRTV-001: In stock, 700 kg, Godown A.
- **Steps:**
  1. D4, operator: Send to vendor → enters 800 kg → confirm.
- **Expected:**
  - Refused, on the tablet before saving and by the server if it arrives anyway:
    "Only 700 kg is left on this roll — you can't return 800 kg to the vendor" (proposed).
  - Nothing is posted. R5 stays In stock, 700 kg.
  - Entering exactly 700 is accepted (that is TC-PRTV-002).

### TC-PRTV-006 Refused: 0 or negative kg
- **Status:** 🆕 to build
- **Covers:** AC-07b (must be refused)
- **Layer:** Both
- **Given:** R21 inward D1 1000 kg, Godown A, In stock.
- **Steps:**
  1. D2, operator: Send to vendor → enters 0 kg → confirm.
  2. D2, operator: Send to vendor → enters −50 kg → confirm (sent to the server directly if the tablet's keypad blocks the minus sign).
- **Expected:**
  - Both refused: "Enter the kg going back to the vendor — it must be more than 0" (proposed).
  - Nothing is posted. R21 stays In stock, 1000 kg.

### TC-PRTV-007 Refused: roll is out on the floor
- **Status:** 🆕 to build (same rule as AC-04 today)
- **Covers:** AC-07b (must be refused)
- **Layer:** Both
- **Given:** R21 inward D1 1000 kg, Godown A; D2 outward to Running Godown (weighed 1000). Status Out.
- **Steps:**
  1. D3, operator: Send to vendor → enters 200 kg → confirm.
- **Expected:**
  - Refused: "This roll is already out — record its return first".
  - Nothing is posted. R21 stays Out, 1000 kg, Running Godown. Reports D3: Closing 1000, Out on floor 1000.

### TC-PRTV-008 Refused: roll already finished
- **Status:** 🆕 to build (same rules as AC-04 today)
- **Covers:** AC-07b; I-4
- **Layer:** Auto
- **Given:** three rolls, each inward D1 1000 kg in Godown A and then finished on D2: R23 consumed
  (outward + return 0), R24 sold whole, R25 returned to vendor whole.
- **Steps:**
  1. D3, operator: partial return to vendor 100 kg on each of R23, R24, R25.
- **Expected:**

  | Roll | Message |
  |---|---|
  | R23 | "This roll is already consumed — there is nothing left to return" |
  | R24 | "This roll has already been sold" |
  | R25 | "This roll has already been returned to the vendor" |

  - Nothing is posted for any of them; all stay at 0 kg with no godown.

### TC-PRTV-009 Partial return to vendor after partial use on the floor
- **Status:** 🆕 to build
- **Covers:** AC-03, AC-07b; I-1, I-2
- **Layer:** Both
- **Given:** R26 (RT 501) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2, operator: outward to Running Godown, weighed 1000.
  2. D3, operator: return 600 kg to Godown A.
  3. D4, operator: partial return to vendor 200 kg.
- **Expected:**
  - R26: In stock, 400 kg, Godown A.
  - History: Received 1000; Issued out 1000 kg to Running Godown; Returned 600 kg to Godown A · 400 kg used; Returned 200 kg to vendor.
  - ERPNext: Purchase Return for 200 against R26's original receipt, from Godown A, D4. Batch balance Godown A = 400.
  - Reports D2: Closing 1000, Out on floor 1000. D3: Consumed 400, Closing 600. D4: Opening 600, Returned to vendor 200, Closing 400.

### TC-PRTV-010 Offline partial, then a network retry: posted once
- **Status:** 🆕 to build
- **Covers:** AC-07b, AC-08b, E-1, T-5
- **Layer:** Both
- **Given:** R27 (RT 502) inward D1 1000 kg, Godown A. R28 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D3 evening, tablet offline. Operator: partial return to vendor 300 kg on R27.
  2. Operator, still offline: partial sale 200 kg of R28 to Direct Sale.
  3. Tablet shows R27 at 700 and R28 at 800 while offline.
  4. D4 morning, tablet back online; sync is sent, the response is lost, sync is sent again (same scans).
- **Expected:**
  - R27: In stock 700; one "Returned 300 kg to vendor" row; one Purchase Return (300). Never 400 kg / two returns.
  - R28: In stock 800; one "Sold 200 kg" row; one Delivery Note (200).
  - Both movements dated D3. Reports D3: Returned to vendor 300 and Sold 200 (RT 502); Closing 1500. Reports D4: no movement.

### TC-PRTV-011 Offline partial that no longer fits is refused at sync
- **Status:** 🆕 to build
- **Covers:** AC-07b, E-2, T-6
- **Layer:** Auto
- **Given:** R29 (RT 501) inward D1 1000 kg, Godown A. Tablets A and B both synced on D1.
- **Steps:**
  1. D2, tablet A offline: partial return to vendor 300 kg on R29.
  2. D2, tablet B online: partial sale 800 kg of R29 (accepted → 200 kg left).
  3. D2, tablet A syncs.
- **Expected:**
  - Tablet A's return is refused: "Only 200 kg is left on this roll — you can't return 300 kg to the vendor" (proposed); the tablet shows it as a failed sync item.
  - Nothing is posted for it. R29: In stock, 200 kg. Reports D2: Sold 800, Closing 200.

---

## Partial sale (AC-08b)

### TC-PSELL-001 Sell part of a roll, keep the rest
- **Status:** 🆕 to build
- **Covers:** AC-08b; I-1, I-2
- **Layer:** Both
- **Given:** R6 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D4, operator: scans R6 → Sell → enters 250 kg → no buyer picked → Savio bill no SAV-1001, vehicle no ka01ab1234 → photo → confirm. Sync.
- **Expected:**
  - R6: **In stock**, 750 kg, Godown A.
  - History: Received 1000; "Sold 250 kg" (D4) with buyer Direct Sale, bill SAV-1001, vehicle KA01AB1234.
  - ERPNext: submitted Delivery Note to Direct Sale for 250 kg of R6's batch from Godown A, dated D4;
    bill no and vehicle no kept with the sale. Batch balance Godown A = 750.
  - Reports D4: Opening 1000, Sold 250, Closing 750.
  - R6 can still go outward (continues the golden story: out → return 500).

### TC-PSELL-002 Several partial sales to different buyers, then the rest sold whole
- **Status:** 🆕 to build
- **Covers:** AC-08a, AC-08b; I-4, I-5
- **Layer:** Auto
- **Given:** R21 (RT 501) inward D1 1000 kg, Godown A. Customer "Sharma Prints" exists.
- **Steps:**
  1. D2, operator: partial sale 250 kg, no buyer, bill SAV-2001, vehicle KA01AB1111.
  2. D2, operator: partial sale 300 kg to Sharma Prints, bill SAV-2002, vehicle KA02CD2222.
  3. D4, operator: Sell **without** kg (whole roll, as today), Sharma Prints, bill SAV-2003, vehicle KA02CD2222.
- **Expected:**
  - R21: **Sold**, 0 kg, no godown.
  - History: Received 1000; Sold 250 kg (Direct Sale, SAV-2001, KA01AB1111); Sold 300 kg (Sharma Prints, SAV-2002, KA02CD2222); "Sold — 450 kg" (Sharma Prints, SAV-2003). Each row keeps its own buyer, bill no and vehicle no.
  - ERPNext: 3 Delivery Notes — 250 to Direct Sale, 300 and 450 to Sharma Prints.
  - Reports D2: Sold 550, Closing 450. D4: Opening 450, Sold 450, Closing 0. Weekly D1–D7: Received 1000, Sold 1000, Closing 0.
  - (Selling exactly the remaining kg as a partial finishes the roll the same way — mirrors TC-PRTV-002.)

### TC-PSELL-003 Refused: more kg than the roll holds
- **Status:** 🆕 to build
- **Covers:** AC-08b (must be refused)
- **Layer:** Both
- **Given:** R6 after TC-PSELL-001: In stock, 750 kg.
- **Steps:**
  1. D5, operator: Sell → enters 800 kg → confirm.
- **Expected:**
  - Refused: "Only 750 kg is left on this roll — you can't sell 800 kg" (proposed).
  - Nothing is posted. R6 stays In stock, 750 kg.

### TC-PSELL-004 Refused: 0 or negative kg
- **Status:** 🆕 to build
- **Covers:** AC-08b (must be refused)
- **Layer:** Both
- **Given:** R22 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2, operator: Sell → enters 0 kg → confirm.
  2. D2, operator: Sell → enters −100 kg → confirm.
- **Expected:**
  - Both refused: "Enter the kg being sold — it must be more than 0" (proposed).
  - Nothing is posted. R22 stays In stock, 1000 kg.

### TC-PSELL-005 Refused: roll is out on the floor
- **Status:** 🆕 to build (same rule as AC-05 today)
- **Covers:** AC-08b (must be refused)
- **Layer:** Both
- **Given:** R22 inward D1 1000 kg; D2 outward to Running Godown (weighed 1000).
- **Steps:**
  1. D3, operator: Sell → enters 200 kg → confirm.
- **Expected:**
  - Refused: "This roll is out on production — receive it back before selling it".
  - Nothing is posted. R22: Out, 1000 kg, Running Godown.

### TC-PSELL-006 Refused: roll already finished
- **Status:** 🆕 to build (same rules as AC-05 today)
- **Covers:** AC-08b; I-4
- **Layer:** Auto
- **Given:** R23 consumed, R24 sold whole, R25 returned to vendor whole (as in TC-PRTV-008).
- **Steps:**
  1. D3, operator: partial sale 100 kg on each.
- **Expected:**

  | Roll | Message |
  |---|---|
  | R23 | "This roll is already consumed — there is nothing left to sell" |
  | R24 | "This roll has already been sold" |
  | R25 | "This roll has already been returned to the vendor" |

  - Nothing is posted for any of them.

### TC-PSELL-007 Godown roles never see the price of a partial sale
- **Status:** 🆕 to build · 🔶 price per kg or per roll
- **Covers:** AC-08b, AC-05, E-8
- **Layer:** Both
- **Given:** R26 (RT 501) inward D1 1000 kg, Godown A. A price is recorded on the sale by whoever
  is allowed to enter it (🔶 where/who — see open questions): ₹50 per kg (🔶 or ₹20,000 for the piece).
- **Steps:**
  1. D2: partial sale 400 kg of R26 to Sharma Prints, bill SAV-3001, with the price.
  2. Operator opens R26's history on the tablet (after a pull).
  3. Supervisor opens R26 on the portal, the daily roll report for D2 and its CSV, and tries to open the Delivery Note's rate in ERPNext.
  4. Admin opens the same screens.
- **Expected:**
  - Operator and supervisor: the "Sold 400 kg" row shows kg, buyer, bill no, vehicle no — **no price anywhere**; ERPNext rate lookups refused with "You do not have permission to perform this action".
  - Admin (and super admin): sees the price; Delivery Note amount ₹20,000 for 400 kg (₹50/kg) 🔶.
  - R26: In stock 600. Reports D2: Sold 400, Closing 600 (reports carry kg only).

### TC-PSELL-008 Partial sale + partial return to vendor + floor use on one roll
- **Status:** 🆕 to build
- **Covers:** AC-03, AC-07b, AC-08a, AC-08b; I-1, I-2, I-4, I-5, I-6
- **Layer:** Both (golden-dataset style)
- **Given:** R27 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2, operator: partial sale 200 kg, Direct Sale, bill SAV-4001, vehicle KA01AB4001.
  2. D3, operator: partial return to vendor 100 kg.
  3. D4, operator: outward to Running Godown, weighed 700.
  4. D6, operator: return 500 kg to Godown A.
  5. D8, operator: Sell (whole roll), Direct Sale, bill SAV-4002.
- **Expected:**

  | Day | R27 | Received | Consumed | Returned to vendor | Sold | Closing | Out on floor |
  |---|---|---|---|---|---|---|---|
  | D1 | In stock 1000, Godown A | 1000 | 0 | 0 | 0 | 1000 | 0 |
  | D2 | In stock 800, Godown A | 0 | 0 | 0 | 200 | 800 | 0 |
  | D3 | In stock 700, Godown A | 0 | 0 | 100 | 0 | 700 | 0 |
  | D4 | Out 700, Running Godown | 0 | 0 | 0 | 0 | 700 | 700 |
  | D5 | unchanged | 0 | 0 | 0 | 0 | 700 | 700 |
  | D6 | In stock 500, Godown A | 0 | **200** | 0 | 0 | 500 | 0 |
  | D7 | unchanged | 0 | 0 | 0 | 0 | 500 | 0 |
  | D8 | Sold, 0, no godown | 0 | 0 | 0 | 500 | 0 | 0 |

  - History, 6 rows: Received 1000; Sold 200 kg; Returned 100 kg to vendor; Issued out 700 kg to Running Godown; Returned 500 kg to Godown A · 200 kg used; Sold — 500 kg.
  - ERPNext: Purchase Receipt 1000; Delivery Note 200; Purchase Return 100; transfer 700 A → Running Godown; 200 kg issued (consumed) + 500 transferred back to Godown A; Delivery Note 500. Batch balance after each day = the roll (I-1).
  - No store loss on D4: weighed 700 = recorded 700.
  - Weekly D1–D7: Received 1000, Consumed 200, Returned to vendor 100, Sold 200, Closing 500. Week D8–D14: Opening 500, Sold 500, Closing 0.

---

## Store loss at outward (AC-09)

### TC-LOSS-001 Roll lighter than recorded at outward
- **Status:** 🆕 to build
- **Covers:** AC-09; I-1, I-2, I-6
- **Layer:** Both
- **Given:** R7 (RT 501) inward D1 100 kg, Godown A. No other movement.
- **Steps:**
  1. D5 10:00, operator on tablet: scan R7 → Outward → Running Godown → scale shows 80 kg → scale photo → confirm. Sync.
- **Expected:**
  - R7: **Out**, current **80 kg**, Running Godown.
  - History: Received 100 kg (D1); "Store loss 20 kg" (D5); "Issued out 80 kg to Running Godown" (D5) — the loss row **before** the outward row.
  - ERPNext: 20 kg of R7's batch written off from Godown A, dated D5; then a transfer of 80 kg Godown A → Running Godown. Batch balance: Godown A 0, Running Godown 80 (I-1).
  - Reports D5: Opening 100, **Store loss 20**, Closing 80, Out on floor 80. Daily roll report and CSV show both rows.
  - Alerts page: one open **Store loss** alert, date D5:
    "R7 weighed 80 kg at outward — 20 kg less than the 100 kg recorded (last weighed D1 in Godown A)",
    with the scale photo (opens), the operator's name, and D5. Badge count +1.

### TC-LOSS-002 Return after a store loss counts consumption from the weighed kg
- **Status:** 🆕 to build
- **Covers:** AC-09, AC-03; I-2
- **Layer:** Auto
- **Given:** R7 after TC-LOSS-001: Out, 80 kg.
- **Steps:**
  1. D7, operator: return 50 kg to Godown A.
- **Expected:**
  - R7: In stock, 50 kg, Godown A.
  - History row "Returned 50 kg to Godown A · 30 kg used".
  - Reports D7: Consumed **30** (not 50), Closing 50. Weekly D1–D7: Received 100, Store loss 20, Consumed 30, Closing 50.
  - The store-loss alert is unchanged (still open until reviewed).

### TC-LOSS-003 Difference within tolerance: no loss, no alert
- **Status:** 🆕 to build · 🔶 tolerance 1 kg or 1 % (whichever larger), boundary inclusive
- **Covers:** AC-09 (tolerance)
- **Layer:** Auto
- **Given:** fresh rolls, each inward D1 in Godown A, outward D2 to Running Godown.
- **Steps:**
  1. D2, operator: outward each roll with the scale reading below.
- **Expected:** for every row: roll goes out at its **recorded** kg; one history row "Issued out <recorded> kg"; no store-loss row; no write-off in ERPNext; Store loss 0 in reports D2; **no alert**. The scale reading is still kept on the outward row (as today's note "Scale reading: … kg").

  | Roll | Recorded | Scale | Difference | Tolerance | Why no loss |
  |---|---|---|---|---|---|
  | R31 | 100 | 99 | −1 | 1 | exactly at the 1 kg / 1 % boundary |
  | R32 | 50 | 49 | −1 | 1 | 1 kg is larger than 1 % (0.5) — at boundary |
  | R33 | 1000 | 990 | −10 | 10 | 1 % is larger than 1 kg — at boundary |
  | R34 | 1000 | 995 | −5 | 10 | 5 kg lighter but within 1 % |
  | R35 | 100 | 101 | +1 | 1 | heavier, at boundary — no "heavier" alert |

  - Reports D2: Closing = sum of recorded kg, Out on floor = same.

### TC-LOSS-004 Difference just over tolerance: the full difference is a store loss
- **Status:** 🆕 to build · 🔶 tolerance value
- **Covers:** AC-09 (tolerance)
- **Layer:** Auto
- **Given:** fresh rolls, each inward D1 in Godown A.
- **Steps:**
  1. D2, operator: outward each roll with the scale reading below.
- **Expected:** each roll goes out at the scale reading; a "Store loss" row of the **whole** difference (not just the part above tolerance); ERPNext write-off of that amount from Godown A on D2; one Store loss alert each.

  | Roll | Recorded | Scale | Tolerance | Store loss | Goes out at |
  |---|---|---|---|---|---|
  | R36 | 100 | 98.5 | 1 | 1.5 | 98.5 |
  | R37 | 50 | 48.5 | 1 | 1.5 | 48.5 |
  | R38 | 1000 | 989 | 10 | 11 | 989 |

  - Reports D2 (Base paper): Store loss 14, Closing 1136, Out on floor 1136.

### TC-LOSS-005 Heavier at outward: stock unchanged, "heavier" alert
- **Status:** 🆕 to build · 🔶 whole behaviour to confirm
- **Covers:** AC-09 (heavier)
- **Layer:** Both
- **Given:** R39 (RT 501) inward D1 100 kg, Godown A.
- **Steps:**
  1. D3, operator: outward to Running Godown, scale shows 102 kg, photo, confirm.
  2. D5, operator: return 60 kg.
- **Expected:**
  - After step 1: R39 Out at **100 kg** (recorded, not 102). History: Received 100; Issued out 100 kg to Running Godown. No store-loss row, no ERPNext adjustment. Reports D3: Store loss 0, Adjusted 0, Closing 100, Out on floor 100.
  - Alerts page: one open alert (🔶 type — "Store loss" or its own "Heavier" type):
    "R39 weighed 102 kg at outward — 2 kg more than the 100 kg recorded (last weighed D1 in Godown A)", with scale photo, operator, D3. It stays open until marked reviewed.
  - After step 2: Reports D5 Consumed 40 (100 − 60), Closing 60.

### TC-LOSS-006 Scale reads 0 at outward
- **Status:** 🆕 to build · 🔶 behaviour not decided
- **Covers:** AC-09
- **Layer:** Both
- **Given:** R31 inward D1 100 kg, Godown A. (Today the tablet accepts a reading of 0.)
- **Steps:**
  1. D2, operator: outward to Running Godown, scale reads 0 kg, photo, confirm.
- **Expected (proposed):**
  - Refused on the tablet and by the server: "The scale reads 0 kg — weigh the roll again. If the roll is really gone, ask a supervisor to correct it on the portal" (proposed).
  - Nothing is posted. R31 stays In stock, 100 kg, Godown A. No alert.

### TC-LOSS-007 Second outward compares against the weight it came back with
- **Status:** 🆕 to build
- **Covers:** AC-09, AC-03; I-2
- **Layer:** Auto
- **Given:** R32 (RT 501) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2, operator: outward, weighed 1000 (no loss).
  2. D3, operator: return 600 kg to Godown A (consumed 400).
  3. D5, operator: outward, scale shows 590.
- **Expected:**
  - Compared against **600** (the return weight), not 1000. Tolerance = max(1, 6) = 6; difference 10 → store loss 10.
  - R32: Out, 590 kg, Running Godown. History adds "Store loss 10 kg" then "Issued out 590 kg to Running Godown" (D5).
  - ERPNext: 10 kg written off from Godown A on D5; 590 transferred to Running Godown.
  - Reports D3: Consumed 400, Closing 600. D5: Store loss 10, Closing 590, Out on floor 590.
  - Alert: "R32 weighed 590 kg at outward — 10 kg less than the 600 kg recorded (last weighed D3 in Godown A)".
  - Control: had the scale shown 595, difference 5 ≤ 6 → no loss, no alert.

### TC-LOSS-008 Backdated outward (yesterday) with a store loss
- **Status:** 🆕 to build · 🔶 alert date
- **Covers:** AC-09, T-4; I-2, I-3
- **Layer:** Auto
- **Given:** R33 (RT 501) inward D1 100 kg, Godown A.
- **Steps:**
  1. D6 09:00, operator: outward dated **yesterday (D5)**, scale 80, photo, confirm. Sync.
- **Expected:**
  - Store-loss row and outward row both dated D5; ERPNext write-off and transfer posted on D5.
  - Reports D5 (re-run on D6): Store loss 20, Closing 80, Out on floor 80. Reports D6: Opening 80, Closing 80, Out on floor 80. Stock as of D4 still 100 in Godown A.
  - Alert dated D5 (the movement date) and showing "recorded D6 09:00" 🔶.

### TC-LOSS-009 Store loss recorded offline, synced twice
- **Status:** 🆕 to build
- **Covers:** AC-09, T-5, E-1
- **Layer:** Both
- **Given:** R34 (RT 501) inward D1 100 kg, Godown A.
- **Steps:**
  1. D9 18:00, tablet offline. Operator: outward, scale 80, photo, confirm.
  2. D10 08:00, tablet online; sync sent, response lost, sync sent again.
- **Expected:**
  - Exactly one "Store loss 20 kg" row, one "Issued out 80 kg" row, one write-off, one transfer, **one** alert. Never 40 kg lost.
  - Rows dated D9. Reports D9: Store loss 20, Closing 80, Out on floor 80. D10: nothing new.
  - The alert's scale photo is the one taken offline.

---

## Minimum stock per design (AC-10)

"In store" for a design = kg of its rolls that are In stock in a storage godown (Godown A, Godown B).
Rolls out on the floor do not count (🔶). This equals report Closing − Out on floor.

### TC-MIN-001 Set a minimum on the Paper Codes page; who may
- **Status:** 🆕 to build · 🔶 kg (not roll count); 🔶 which roles
- **Covers:** AC-10 (setup), E-8
- **Layer:** Manual
- **Given:** Paper Codes page lists ARIHANT rows RT 501 / Delta 730N and RT 502, no minimums.
- **Steps:**
  1. Admin: Paper Codes → RT 501 row → Minimum stock (kg) = 1500 → Save.
  2. Supervisor: sets RT 502 minimum = 800 → Save.
  3. Admin: edits RT 502's Delta code on the same vendor and saves.
  4. Operator: tries to log in to the portal.
- **Expected:**
  - Rows show RT 501 minimum 1500 kg, RT 502 minimum 800 kg; values survive a page reload.
  - Step 3 leaves RT 501's minimum at 1500 (editing other paper fields of the vendor does not wipe minimums).
  - 🔶 Proposed who may set it: supervisor, admin, super admin. Operator cannot (no portal login, as today).

### TC-MIN-002 Minimum value validation
- **Status:** 🆕 to build · 🔶 meaning of 0
- **Covers:** AC-10 (setup)
- **Layer:** Both
- **Given:** RT 501 minimum 1500.
- **Steps:**
  1. Admin enters −100 → Save.
  2. Admin enters "abc" → Save.
  3. Admin enters 1500.5 → Save.
  4. Admin clears the field → Save.
- **Expected:**
  - Step 1 refused: "Minimum stock can't be negative" (proposed). Minimum stays 1500.
  - Step 2 refused: "Minimum stock must be a number of kg" (proposed). Minimum stays 1500.
  - Step 3 saved: 1500.5.
  - Step 4 saved: no minimum (the design never alerts). 🔶 0 is treated the same as blank.

### TC-MIN-003 Dropping below the minimum raises one alert (floor rolls don't count)
- **Status:** 🆕 to build · 🔶 "in store" excludes floor rolls
- **Covers:** AC-10
- **Layer:** Both
- **Given:** D1: R8 1000 kg and R9 1000 kg (RT 501) inward to Godown A. Then admin sets RT 501 minimum 1500 (in store 2000 — no alert).
- **Steps:**
  1. D3, operator: outward R8 to Running Godown, weighed 1000.
- **Expected:**
  - Reports D3 (RT 501): Closing 2000, Out on floor 1000 → in store 1000.
  - Alerts page: **one** open Low stock alert: "RT 501 below minimum: 1000 kg in store, minimum 1500", date D3. Badge +1.
  - No alert on D1 or D2.

### TC-MIN-004 Further moves update the same alert, no duplicates
- **Status:** 🆕 to build
- **Covers:** AC-10 (one open alert per design)
- **Layer:** Auto
- **Given:** state after TC-MIN-003 (one open alert, in store 1000).
- **Steps:**
  1. D4, operator: R8 returns 200 kg to Godown A.
  2. D5, operator: partial sale 300 kg of R9.
- **Expected:**
  - After step 1: in store 1200; the **same** alert now reads "1200 kg in store, minimum 1500"; still open. Reports D4: Consumed 800, Closing 1200.
  - After step 2: in store 900; same alert reads "900 kg in store, minimum 1500". Reports D5: Sold 300, Closing 900.
  - Exactly one Low stock alert for RT 501 exists; badge count unchanged since D3.

### TC-MIN-005 Recovery to the minimum closes the alert by itself
- **Status:** 🆕 to build
- **Covers:** AC-10 (auto close)
- **Layer:** Both
- **Given:** state after TC-MIN-004 (open alert, in store 900).
- **Steps:**
  1. D6, operator: inward R41 (RT 501) 600 kg to Godown A.
- **Expected:**
  - In store 1500 = minimum → alert **closes itself** (≥ minimum is not low), stamped "closed automatically D6 — 1500 kg in store".
  - It disappears from the Open filter and the badge; it stays visible in the closed / reviewed list 🔶.
  - Reports D6: Received 600, Closing 1500.

### TC-MIN-006 Dropping below again after recovery opens a new alert
- **Status:** 🆕 to build · 🔶 new alert vs reopen
- **Covers:** AC-10
- **Layer:** Auto
- **Given:** state after TC-MIN-005 (alert closed, in store 1500).
- **Steps:**
  1. D8, operator: outward R41, weighed 600.
- **Expected:**
  - In store 900 → a **new** open Low stock alert dated D8 ("900 kg in store, minimum 1500"). The D3 alert stays closed with its own history. Badge +1.

### TC-MIN-007 Designs without a minimum never alert
- **Status:** 🆕 to build
- **Covers:** AC-10
- **Layer:** Auto
- **Given:** RT 502 has no minimum. R42 (RT 502) inward D1 500 kg, Godown A.
- **Steps:**
  1. D2, operator: sell R42 whole.
- **Expected:**
  - RT 502 in store 0. No Low stock alert for RT 502, now or on any later day.

### TC-MIN-008 Minimum set while stock is already below it
- **Status:** 🆕 to build · 🔶 alert at once
- **Covers:** AC-10
- **Layer:** Both
- **Given:** R43 (RT 502) inward D1 500 kg, Godown A; RT 502 has no minimum.
- **Steps:**
  1. D2, admin: sets RT 502 minimum 800.
- **Expected (proposed):**
  - One Low stock alert opens straight away, dated D2: "RT 502 below minimum: 500 kg in store, minimum 800".
  - Same for a design with 0 kg in store: alert "0 kg in store".

### TC-MIN-009 Minimum changed while an alert is open
- **Status:** 🆕 to build
- **Covers:** AC-10
- **Layer:** Auto
- **Given:** state after TC-MIN-004 (RT 501 alert open, in store 900, minimum 1500).
- **Steps:**
  1. D5, admin: raises RT 501 minimum to 2000.
  2. D5, admin: lowers RT 501 minimum to 800.
- **Expected:**
  - After step 1: the same alert reads "900 kg in store, minimum 2000"; still one alert.
  - After step 2: 900 ≥ 800 → alert closes itself ("closed automatically D5 — minimum changed to 800") 🔶 wording. No stock or report change.

### TC-MIN-010 Minimum removed while an alert is open
- **Status:** 🆕 to build · 🔶
- **Covers:** AC-10
- **Layer:** Auto
- **Given:** state after TC-MIN-004 (RT 501 alert open, in store 900).
- **Steps:**
  1. D5, admin: clears RT 501's minimum → Save.
  2. D6, operator: sells R9 whole (in store drops further).
- **Expected:**
  - After step 1: the alert closes itself ("minimum removed") 🔶; badge −1.
  - After step 2: no new alert.

### TC-MIN-011 Opening-stock load does not raise low-stock alerts
- **Status:** 🆕 to build
- **Covers:** AC-10, Opening stock ("minimums set after the load"), OS-3
- **Layer:** Auto
- **Given:** no minimums set. Go-live sheet: RT 501 — 30 rolls totalling 9000 kg in Godown A + 2 rolls 600 kg out in Running Godown; RT 502 — 3 rolls 300 kg in Godown B.
- **Steps:**
  1. Load day L: bulk load the sheet.
  2. L+1, admin: sets RT 501 minimum 5000 and RT 502 minimum 1000.
- **Expected:**
  - After step 1: alerts page empty; badge 0.
  - After step 2: RT 501 in store 9000 ≥ 5000 → no alert (the 600 on the floor is not counted). RT 502 in store 300 < 1000 → exactly one alert (per TC-MIN-008). Never one alert per roll.

---

## Alerts page (AC-09, AC-10)

### TC-ALERT-001 Who sees the Alerts page
- **Status:** 🆕 to build · 🔶 store manager
- **Covers:** Alerts page, E-8
- **Layer:** Both
- **Given:** one open Store loss alert (TC-LOSS-001) and one open Low stock alert (TC-MIN-003).
- **Steps:**
  1. Supervisor, admin, super admin each log in to the portal and open Alerts.
  2. Operator: logs in on the tablet; tries the portal; calls the alerts list directly with their token.
- **Expected:**
  - Supervisor, admin, super admin: "Alerts" in the menu with badge 2; both alerts listed.
  - Operator: no alerts anywhere on the tablet; portal login refused (as today); the direct call refused with "You do not have permission to perform this action".
  - 🔶 Store manager (role exists today): not decided.

### TC-ALERT-002 Badge shows the open count
- **Status:** 🆕 to build
- **Covers:** Alerts page
- **Layer:** Both
- **Given:** no alerts. RT 501 minimum 1500 with 2000 in store (R8, R9 in Godown A). R31 (RT 501) inward D1 100 kg, Godown A.
- **Steps:**
  1. D3: R8 outward (low stock alert opens).
  2. D3: R31 outward, weighed 80 (store loss alert opens).
  3. D4: supervisor marks the store-loss alert reviewed.
  4. D6: inward 600 RT 501 (low-stock alert closes itself).
- **Expected:** badge after each step: 1 → 2 → 1 → 0 (no badge shown at 0). The count updates without logging out (on next page load at the latest).

### TC-ALERT-003 Columns and filters
- **Status:** 🆕 to build · 🔶 which date the range filters on
- **Covers:** Alerts page
- **Layer:** Manual
- **Given:** alerts: Store loss R7 (D5, open); Store loss R32 (D5, reviewed D6); Low stock RT 501 (D3, open); Low stock RT 501 (closed D6).
- **Steps:**
  1. Supervisor opens Alerts (default view).
  2. Filters status = Reviewed.
  3. Filters type = Low stock, status = all.
  4. Filters date range D4–D5.
- **Expected:**
  - Columns: type, roll or design, figures, date, status.
  - Step 1: the open ones (R7, RT 501 D3) 🔶 default = Open.
  - Step 2: R32 (and the closed low-stock alert, if closed counts as "reviewed" 🔶).
  - Step 3: both RT 501 alerts.
  - Step 4: R7 and R32 (range inclusive, by alert date).

### TC-ALERT-004 Mark a store-loss alert reviewed with a comment
- **Status:** 🆕 to build
- **Covers:** AC-09, Alerts page
- **Layer:** Both
- **Given:** open Store loss alert for R7 (TC-LOSS-001).
- **Steps:**
  1. D6 11:00, supervisor: opens the alert → views the scale photo → Mark reviewed → comment "Paper dried out in Godown A, checked with operator" → confirm.
- **Expected:**
  - Alert status Reviewed; shows reviewed by (supervisor's name), reviewed at D6 11:00, the comment. These cannot be edited afterwards.
  - Leaves the Open list; badge −1.
  - R7's stock, history, ERPNext and reports are **unchanged** by the review (the loss stays booked on D5).

### TC-ALERT-005 Review needs a comment
- **Status:** 🆕 to build · 🔶 comment mandatory
- **Covers:** Alerts page
- **Layer:** Both
- **Given:** open Store loss alert for R7.
- **Steps:**
  1. Supervisor: Mark reviewed with an empty comment (and with only spaces).
- **Expected:**
  - Refused: "Add a comment saying what was checked before marking this alert reviewed" (proposed).
  - Alert stays open; nothing recorded.

### TC-ALERT-006 Low-stock alerts can't be closed by hand
- **Status:** 🆕 to build · 🔶 whether a comment / acknowledge is allowed
- **Covers:** AC-10, Alerts page
- **Layer:** Both
- **Given:** open Low stock alert for RT 501.
- **Steps:**
  1. Supervisor opens it.
  2. Supervisor (or admin) sends a "mark reviewed" for it directly to the server.
- **Expected:**
  - No Mark reviewed button on low-stock alerts.
  - Step 2 refused: "Low-stock alerts close by themselves once stock is back at the minimum" (proposed). Alert stays open.

### TC-ALERT-007 Already reviewed: second review refused
- **Status:** 🆕 to build
- **Covers:** Alerts page (audit), E-2
- **Layer:** Auto
- **Given:** open Store loss alert for R7; supervisor and admin both have it open.
- **Steps:**
  1. Supervisor marks it reviewed with comment "A".
  2. Admin, from the stale screen, marks it reviewed with comment "B".
- **Expected:**
  - Step 2 refused: "This alert was already reviewed by <supervisor> on D6 11:00" (proposed).
  - The alert keeps reviewer = supervisor, comment "A". One review record only.

---

## Godown move via portal location edit (AC-06)

### TC-MOVE-001 Untouched roll: A → B
- **Status:** ✅ today
- **Covers:** AC-06, E-3; I-1
- **Layer:** Both
- **Given:** R4 (RT 502) inward D1 700 kg, Godown A; no other movement.
- **Steps:**
  1. D3, supervisor on portal: Rolls → R4 → Edit → Location: Godown B → Save.
- **Expected:**
  - R4: In stock, 700 kg, Godown B.
  - History: still **one** row, "Received 700 kg" (now showing Godown B).
  - ERPNext: R4's receipt is re-posted into Godown B with its original date D1 (the old receipt cancelled, the new one amending it); batch balance Godown B 700, Godown A 0. Note: AC-06 says "stock transfer"; for a roll that has not moved, today's system corrects the receipt instead (as E-3) — see open questions.
  - Reports D1 and D3: unchanged (Received 700 on D1, Closing 700).

### TC-MOVE-002 Roll with history: A → B
- **Status:** ✅ today
- **Covers:** AC-06; I-1, I-6
- **Layer:** Both
- **Given:** R51 (RT 502) inward D1 1000, Godown A; D2 out (weighed 1000); D3 return 600 to Godown A.
- **Steps:**
  1. D4, supervisor on portal: R51 → Edit → Location: Godown B → Save.
- **Expected:**
  - R51: In stock, 600 kg, Godown B.
  - History: still 3 rows (no new row).
  - ERPNext: Stock Entry (Material Transfer) of 600 kg Godown A → Godown B, dated D4. Stock as of D3 still shows Godown A.
  - Reports D4: no movement; Closing 600.
  - Next outward of R51 takes it from Godown B; its return comes back to Godown B.

### TC-MOVE-003 Refused: roll out on the floor
- **Status:** ✅ today
- **Covers:** AC-06 (must be refused)
- **Layer:** Both
- **Given:** R51 inward D1 1000, Godown A; D2 outward to Running Godown.
- **Steps:**
  1. D3, supervisor: R51 → Edit → Location: Godown B → Save.
- **Expected:**
  - Refused: "This roll is out — record its return before changing its location".
  - Nothing is posted. R51 Out, Running Godown.

### TC-MOVE-004 Refused: finished roll
- **Status:** ✅ today
- **Covers:** AC-06 (must be refused); I-4
- **Layer:** Auto
- **Given:** R52 inward D1 500, Godown A; D2 returned to vendor whole.
- **Steps:**
  1. D3, supervisor: R52 → Edit → Location: Godown B → Save.
- **Expected:**
  - Refused: "This roll holds no stock in a godown, so its location can't be changed".
  - Nothing is posted. R52 Returned to vendor, 0 kg, no godown.

### TC-MOVE-005 Moving between storage godowns doesn't change "in store"
- **Status:** 🆕 to build (move ✅; the alert part is new)
- **Covers:** AC-06, AC-10
- **Layer:** Auto
- **Given:** state after TC-MIN-004 (RT 501 alert open, in store 900; R9 700 kg in Godown A, R8 200 kg in Godown A).
- **Steps:**
  1. D5, supervisor: R9 → Location: Godown B → Save.
- **Expected:**
  - RT 501 in store still 900 (Godown A 200 + Godown B 700). The alert's figures don't change; no new alert, no close.
  - Control: with RT 501 at 2000 in store and minimum 1500, the same move raises no alert.

### TC-MOVE-006 Location edit to Running Godown
- **Status:** 🔶 not decided (AC-06 speaks only of storage godowns)
- **Covers:** AC-06, AC-10
- **Layer:** Both
- **Given:** R53 (RT 501) inward D1 1000, Godown A, In stock.
- **Steps:**
  1. D2, supervisor: R53 → Edit → Location: Running Godown → Save.
- **Expected (proposed):**
  - Refused: "Running Godown is the production floor — issue the roll out on the tablet instead" (proposed).
  - Nothing is posted. (Today this is accepted and leaves an In stock roll sitting on the floor godown, which "in store" and Out on floor would then miscount.)

---

## Open questions for the business

**Partial return to vendor / partial sale**

1. **Where and how is the kg entered?** Today Send to vendor and Sell are tablet actions with a photo and no kg. Is the partial kg typed, or weighed on the scale with a photo (like outward)? Is it the weight of the piece going out, or the roll's weight after cutting?
2. **Whole vs partial on the same button?** Is blank kg = whole roll (today's action), or does the operator always enter kg?
3. **Does a partial return to vendor need a remark code / reason?** Today a whole-roll Send to vendor needs at least one remark code. Same for partials?
4. **Partial sale price: per kg or per roll?** Today a sale's price is per roll (ERPNext gets it divided by the kg). For a piece, is the price per kg, or an amount for the piece? Who enters it and where (the tablet doesn't take a price, buyer, bill no or vehicle no today)?
5. **Are Savio bill no and vehicle no mandatory on each partial sale?** Today both are optional.
6. **Is a partial return to vendor / sale also allowed on the portal** (supervisor), or tablet only?
7. **Smallest piece / leftovers:** if a partial leaves a tiny amount (e.g. 2 kg), should the system suggest finishing the roll?

**Store loss**

8. **Tolerance:** confirm 1 kg or 1 % of the **recorded** kg, whichever is larger, with the boundary itself counted as noise (cases TC-LOSS-003/004).
9. **Loss amount:** above tolerance, is the loss the whole difference (assumed) or only the part above tolerance?
10. **Supervisor approval:** does stock drop at once (assumed, per AC-09) or only after a supervisor approves the loss?
11. **Heavier at outward:** confirm stock stays at the recorded kg and an alert is raised; does the 1 kg / 1 % tolerance apply to heavier too; is it a "Store loss" type alert or its own type?
12. **Scale reads 0:** refuse (proposed in TC-LOSS-006), or book the whole roll as store loss?
13. **Wrong reading typed** (e.g. 8 instead of 80): how is a mistaken store loss undone — portal correction (shows as Adjusted, not reversing the loss), or a supervisor "reverse" on the alert?
14. **Tablet warning:** should the tablet warn the operator before confirming ("20 kg less than recorded — check the scale")?
15. **"Last weighed"** after a portal correction or physical count (ADJUSTMENT), or after a portal godown move: which date and godown does the alert show, and from which godown is the loss written off (assumed: where the stock is now)?
16. **Alert date for a backdated or offline outward:** the movement date (assumed) or the day it reached the server?

**Minimum stock**

17. **Kg or roll count?** (🔶 in AC-10.)
18. **What is a "design"?** One vendor's paper row (ARIHANT RT 501) or the RT / Delta code across all vendors (common papers)?
19. **Who may set minimums?** Proposed supervisor, admin, super admin. Store manager?
20. **Floor rolls:** confirm rolls out on the floor don't count toward "in store".
21. **Minimum set above current stock** (including 0 kg): alert at once (proposed) or only on the next crossing?
22. **Is 0 the same as "no minimum"?**
23. **After recovery and a new drop:** new alert (proposed) or reopen the old one?
24. **Minimum removed / lowered while an alert is open:** alert closes itself (proposed)?
25. **Timing:** alerts are evaluated on current stock as each movement is recorded; a backdated movement doesn't create an alert "as of" an earlier day. Confirm.

**Alerts page**

26. **Store manager** role: sees alerts or not?
27. **Comment mandatory** when marking reviewed (proposed yes)? Can a reviewed alert be reopened?
28. **Low-stock alerts:** fully hands-off, or may a supervisor add a note / acknowledge without closing?
29. **Statuses:** is an auto-closed low-stock alert shown as "Closed" (separate from "Reviewed"), and what does the default view show?
30. **Date range filter:** by alert date (movement date) or by date raised / last updated?
31. **Notifications:** only the page and badge, or also email / WhatsApp to supervisors?

**Godown move**

32. **AC-06 wording:** for an untouched roll, today's system re-posts the receipt into the new godown (same as E-3) instead of a stock transfer; the roll and reports come out the same. Accept, or require a transfer always?
33. **Location edit to Running Godown:** refuse (proposed in TC-MOVE-006)?
