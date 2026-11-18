# Test cases 02 — New features: partial returns and sales, store loss, minimum stock, alerts, godown move

Authority: `docs/acceptance/2026-11-04-inventory-acceptance.md` (AC-06, AC-07b, AC-08b, AC-09, AC-10,
Alerts page) and `docs/acceptance/decisions.md` (**D-13…D-20** partial return/sale, **D-21…D-28**
store loss, **D-29…D-37** minimum stock, **D-38…D-41** alerts page, **D-42…D-43** godown move,
**D-55** reopening store-loss alerts).

Status: ✅ works today · 🆕 to build · 🆕 fix = change to today's behaviour.
Layer: **Auto** = timeline test (backend, controlled clock, I-1…I-6 checked after every step) ·
**Manual** = tablet + portal pass · **Both**.

**Conventions for this section**

- Each case starts from the shared setup only (Godown A, Godown B, Running Godown; Base paper;
  ARIHANT with RT 501 / Delta 730N and RT 502; operator, supervisor, super admin) plus the rolls it lists.
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
- **Partial return / partial sale (D-13…D-20):** the operator weighs the **piece going out** (kg);
  the roll keeps the rest. **Part of roll** vs **Whole roll** are separate buttons (only Part asks
  for piece kg). On the tablet, a **scale photo is required** for the piece (D-14). Return-to-vendor
  remark codes are **optional** (D-18). Partial actions work on **tablet and portal**; the portal
  does not require a photo (D-19). **Prices are off** for now (D-15). Bill no and vehicle no stay
  **optional** on partial sales (D-16). Small leftovers stay on the roll — no special finish (D-20).

---

## Partial return to vendor (AC-07b)

### TC-PRTV-001 Return part of a roll to the vendor
- **Status:** 🆕 to build
- **Covers:** AC-07b; I-1, I-2
- **Layer:** Both
- **Given:** R5 (RT 501) inward D1, 1000 kg, Godown A, In stock.
- **Steps:**
  1. D3, operator on tablet: scans R5 → Send to vendor → **Part of roll** → piece **300 kg** (weighed or typed) → scale photo → optional remark → confirm.
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
  1. D5, operator on tablet: Send to vendor → **Part of roll** → piece 700 kg → photo → confirm. Sync.
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
  1. D3, operator on tablet: Send to vendor → **Whole roll** (no piece kg). Sync.
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
  1. D2 10:00, operator: Part of roll → 100 kg piece → photo → confirm.
  2. D2 15:00, operator: Part of roll → 150 kg → photo → confirm.
  3. D4, operator: Part of roll → 200 kg → photo → confirm.
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
  1. D4, operator: Send to vendor → Part of roll → 800 kg → photo → confirm.
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
  1. D2, operator: Send to vendor → Part of roll → 0 kg → confirm.
  2. D2, operator: Send to vendor → Part of roll → −50 kg → confirm (sent to the server directly if the tablet's keypad blocks the minus sign).
- **Expected:**
  - Both refused: "Enter the kg going back to the vendor — it must be more than 0" (proposed).
  - Nothing is posted. R21 stays In stock, 1000 kg.

### TC-PRTV-007 Refused: roll is out on the floor
- **Status:** 🆕 to build (same rule as AC-04 today)
- **Covers:** AC-07b (must be refused)
- **Layer:** Both
- **Given:** R21 inward D1 1000 kg, Godown A; D2 outward to Running Godown (weighed 1000). Status Out.
- **Steps:**
  1. D3, operator: Send to vendor → Part of roll → 200 kg → photo → confirm.
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
  3. D4, operator: Part of roll → 200 kg piece → photo → confirm.
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
  1. D3 evening, tablet offline. Operator: Part of roll → 300 kg on R27 → photo taken offline.
  2. Operator, still offline: Sell → Part of roll → 200 kg of R28 → photo.
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
  1. D2, tablet A offline: Part of roll → 300 kg on R29 → photo.
  2. D2, tablet B online: Sell → Part of roll → 800 kg of R29 → photo (accepted → 200 kg left).
  3. D2, tablet A syncs.
- **Expected:**
  - Tablet A's return is refused: "Only 200 kg is left on this roll — you can't return 300 kg to the vendor" (proposed); the tablet shows it as a failed sync item.
  - Nothing is posted for it. R29: In stock, 200 kg. Reports D2: Sold 800, Closing 200.

### TC-PRTV-012 Refused: Part of roll without a scale photo (tablet)
- **Status:** 🆕 to build
- **Covers:** AC-07b, D-14
- **Layer:** Both
- **Given:** R5 after TC-PRTV-001: In stock, 700 kg, Godown A.
- **Steps:**
  1. D4, operator: Send to vendor → Part of roll → 100 kg → tries to confirm without a photo.
  2. Same action sent to the server with kg but no photo attachment.
- **Expected:**
  - Refused: "Take a photo of the piece on the scale before confirming" (proposed).
  - Nothing is posted. R5 stays In stock, 700 kg.

### TC-PRTV-013 Partial return on the portal (no photo)
- **Status:** 🆕 to build
- **Covers:** AC-07b, D-19
- **Layer:** Both
- **Given:** R21 (RT 501) inward D1 1000 kg, Godown A, In stock.
- **Steps:**
  1. D3, supervisor on portal: Rolls → R21 → Send to vendor → Part of roll → 250 kg → optional remark → Save.
- **Expected:**
  - R21: In stock, 750 kg, Godown A.
  - History: Received 1000; "Returned 250 kg to vendor" (D3) — no scale photo on the row.
  - ERPNext: Purchase Return for 250 kg from Godown A, D3. Reports D3: Returned to vendor 250, Closing 750.

---

## Partial sale (AC-08b)

### TC-PSELL-001 Sell part of a roll, keep the rest
- **Status:** 🆕 to build
- **Covers:** AC-08b; I-1, I-2
- **Layer:** Both
- **Given:** R6 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D4, operator: scans R6 → Sell → **Part of roll** → piece 250 kg → scale photo → no buyer (Direct Sale) → bill SAV-1001, vehicle ka01ab1234 → confirm. Sync.
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
  1. D2, operator: Part of roll → 250 kg → photo; no buyer; bill SAV-2001, vehicle KA01AB1111.
  2. D2, operator: Part of roll → 300 kg → photo; Sharma Prints; bill SAV-2002, vehicle KA02CD2222.
  3. D4, operator: **Whole roll**, Sharma Prints, bill SAV-2003, vehicle KA02CD2222.
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
  1. D5, operator: Sell → Part of roll → 800 kg → photo → confirm.
- **Expected:**
  - Refused: "Only 750 kg is left on this roll — you can't sell 800 kg" (proposed).
  - Nothing is posted. R6 stays In stock, 750 kg.

### TC-PSELL-004 Refused: 0 or negative kg
- **Status:** 🆕 to build
- **Covers:** AC-08b (must be refused)
- **Layer:** Both
- **Given:** R22 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2, operator: Sell → Part of roll → 0 kg → confirm.
  2. D2, operator: Sell → Part of roll → −100 kg → confirm.
- **Expected:**
  - Both refused: "Enter the kg being sold — it must be more than 0" (proposed).
  - Nothing is posted. R22 stays In stock, 1000 kg.

### TC-PSELL-005 Refused: roll is out on the floor
- **Status:** 🆕 to build (same rule as AC-05 today)
- **Covers:** AC-08b (must be refused)
- **Layer:** Both
- **Given:** R22 inward D1 1000 kg; D2 outward to Running Godown (weighed 1000).
- **Steps:**
  1. D3, operator: Sell → Part of roll → 200 kg → photo → confirm.
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

### TC-PSELL-007 Partial sale: no price field (D-15)
- **Status:** 🆕 to build
- **Covers:** AC-08b, D-15, D-16, E-8
- **Layer:** Both
- **Given:** R26 (RT 501) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2, operator: Sell → Part of roll → 400 kg → photo → Sharma Prints; bill and vehicle left blank → confirm.
  2. D2, operator: Sell → Part of roll → 100 kg → photo → Direct Sale, bill SAV-3002 only → confirm.
  3. Operator opens R26 history on the tablet; supervisor opens R26 on the portal and ERPNext Delivery Note for D2.
- **Expected:**
  - Tablet and portal sale screens show **no price field** (prices off until Savio billing goes live).
  - Both sales save; history shows kg, buyer, bill/vehicle when entered — never a price.
  - ERPNext Delivery Notes have no rate/amount (same as whole sales today). Supervisor ERPNext rate lookup still refused.
  - R26: In stock 500. Reports D2: Sold 500, Closing 500 (kg only).

### TC-PSELL-008 Partial sale + partial return to vendor + floor use on one roll
- **Status:** 🆕 to build
- **Covers:** AC-03, AC-07b, AC-08a, AC-08b; I-1, I-2, I-4, I-5, I-6
- **Layer:** Both (golden-dataset style)
- **Given:** R27 (RT 502) inward D1 1000 kg, Godown A.
- **Steps:**
  1. D2, operator: Part of roll → 200 kg → photo; Direct Sale; bill SAV-4001, vehicle KA01AB4001.
  2. D3, operator: Part of roll → 100 kg → photo.
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

### TC-PSELL-009 Partial sale on the portal (no photo)
- **Status:** 🆕 to build
- **Covers:** AC-08b, D-19, D-16
- **Layer:** Both
- **Given:** R22 (RT 502) inward D1 1000 kg, Godown A, In stock.
- **Steps:**
  1. D3, supervisor on portal: Rolls → R22 → Sell → Part of roll → 350 kg → Sharma Prints → Save (no bill, no vehicle).
- **Expected:**
  - R22: In stock, 650 kg, Godown A.
  - History: Received 1000; "Sold 350 kg" (D3) to Sharma Prints — no scale photo.
  - ERPNext: Delivery Note 350 kg from Godown A, D3. Reports D3: Sold 350, Closing 650.

---

## Store loss at outward (AC-09)

### TC-LOSS-001 Roll lighter than recorded at outward
- **Status:** 🆕 to build
- **Covers:** AC-09; I-1, I-2, I-6
- **Layer:** Both
- **Given:** R7 (RT 501) inward D1 100 kg, Godown A. No other movement.
- **Steps:**
  1. D5 10:00, operator on tablet: scan R7 → Outward → Running Godown → scale shows 80 kg → scale photo → confirm screen "Recorded 100 kg, you weighed 80 kg — 20 kg will be booked as store loss" → confirm. Sync.
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

### TC-LOSS-003 Difference within 10 kg tolerance: no loss, no alert
- **Status:** 🆕 to build
- **Covers:** AC-09 (tolerance), D-21, D-24
- **Layer:** Auto
- **Given:** system tolerance **10 kg** (D-21). Fresh rolls, each inward D1 in Godown A, outward D2 to Running Godown.
- **Steps:**
  1. D2, operator: outward each roll with the scale reading below (confirm only when a loss would be booked).
- **Expected:** for every row: roll goes out at its **recorded** kg; one history row "Issued out <recorded> kg"; no store-loss row; no write-off; Store loss 0 in reports D2; **no alert**. The scale reading is kept on the outward row.

  | Roll | Recorded | Scale | Difference | Why no loss |
  |---|---|---|---|---|
  | R31 | 100 | 95 | −5 | within 10 kg |
  | R32 | 50 | 45 | −5 | within 10 kg |
  | R33 | 1000 | 992 | −8 | within 10 kg |
  | R34 | 1000 | 990 | −10 | at 10 kg boundary (inclusive) |
  | R35 | 100 | 108 | +8 | heavier within 10 kg — ignored (D-24) |

  - Reports D2: Closing = sum of recorded kg, Out on floor = same.

### TC-LOSS-004 Above 10 kg: whole difference is store loss
- **Status:** 🆕 to build
- **Covers:** AC-09 (tolerance), D-21, D-22, D-23, D-27
- **Layer:** Auto
- **Given:** tolerance 10 kg. Fresh rolls, each inward D1 in Godown A.
- **Steps:**
  1. D2, operator: outward each roll with the scale reading below; confirm on the loss warning screen.
- **Expected:** each roll goes out at the **scale** reading; a "Store loss" row of the **whole** difference (D-22); stock drops **immediately** (D-23); ERPNext write-off from Godown A on D2; one Store loss alert each.

  | Roll | Recorded | Scale | Store loss | Goes out at |
  |---|---|---|---|---|
  | R36 | 100 | 88 | 12 | 88 |
  | R37 | 50 | 38 | 12 | 38 |
  | R38 | 1000 | 985 | 15 | 985 |

  - Reports D2 (Base paper): Store loss 39, Closing 1111, Out on floor 1111.

### TC-LOSS-005 Heavier above tolerance: stock stays, weighed-heavier alert
- **Status:** 🆕 to build
- **Covers:** AC-09 (heavier), D-24
- **Layer:** Both
- **Given:** R39 (RT 501) inward D1 100 kg, Godown A.
- **Steps:**
  1. D3, operator: outward to Running Godown, scale shows 115 kg, photo, confirm (no loss confirm — within tolerance if misread; here +15 kg).
  2. D5, operator: return 60 kg.
- **Expected:**
  - After step 1: R39 Out at **100 kg** (recorded, not 115). History: Received 100; Issued out 100 kg to Running Godown. No store-loss row, no ERPNext adjustment. Reports D3: Store loss 0, Adjusted 0, Closing 100, Out on floor 100.
  - Alerts page: one open **Weighed heavier** alert:
    "R39 weighed 115 kg at outward — 15 kg more than the 100 kg recorded (last weighed D1 in Godown A)", with scale photo, operator, D3. Open until reviewed.
  - After step 2: Reports D5 Consumed 40 (100 − 60), Closing 60.

### TC-LOSS-006 Scale reads 0 at outward
- **Status:** 🆕 to build
- **Covers:** AC-09, D-25
- **Layer:** Both
- **Given:** R31 inward D1 100 kg, Godown A.
- **Steps:**
  1. D2, operator: outward to Running Godown, scale reads 0 kg, photo, confirm.
- **Expected:**
  - Refused on the tablet and by the server: "A roll can't go out at 0 kg — check the scale" (proposed). If the roll is really gone, use a physical count (D-05).
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
  - Compared against **600** (the return weight), not 1000. Tolerance 10 kg; difference 10 → **no loss** (at boundary).
  - R32: Out, **600 kg**, Running Godown. History: one "Issued out 600 kg" row only (D5).
  - ERPNext: transfer 600 kg to Running Godown; no write-off.
  - Reports D3: Consumed 400, Closing 600. D5: Store loss 0, Closing 600, Out on floor 600.
  - No alert.
  - Control: scale **579** on D5 → difference 21 → store loss 21, roll out at 579, confirm screen, alert, write-off 21 kg.

### TC-LOSS-008 Backdated outward (yesterday) with a store loss
- **Status:** 🆕 to build
- **Covers:** AC-09, T-4; I-2, I-3; D-28
- **Layer:** Auto
- **Given:** R33 (RT 501) inward D1 100 kg, Godown A.
- **Steps:**
  1. D6 09:00, operator: outward dated **yesterday (D5)**, scale 80, photo, confirm. Sync.
- **Expected:**
  - Store-loss row and outward row both dated D5; ERPNext write-off and transfer posted on D5.
  - Reports D5 (re-run on D6): Store loss 20, Closing 80, Out on floor 80. Reports D6: Opening 80, Closing 80, Out on floor 80. Stock as of D4 still 100 in Godown A.
  - Alert dated **D5** (movement date) and showing when it reached the server (D-28): "recorded D6 09:00".

### TC-LOSS-010 Super admin changes store-loss tolerance
- **Status:** 🆕 to build
- **Covers:** AC-09, D-21
- **Layer:** Manual
- **Given:** default tolerance 10 kg. R45 (RT 501) inward D1 500 kg, Godown A.
- **Steps:**
  1. D2, super admin: Settings → Store loss tolerance = **5 kg** → Save.
  2. D2, operator: outward R45, scale 492 kg → confirm loss screen (8 kg difference).
- **Expected:**
  - Step 2 books store loss **8 kg**; roll out at 492 kg (threshold now 5 kg).
  - A later change back to 10 kg affects **new** outwards only, not R45's movement.

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

A **design** (D-30) is the automatic group of papers sharing an RT code, a Delta code, or linked by a
paper carrying both — **across all vendors** (one minimum applies to the group's total in storage).

"In store" for a design (D-31) = kg of its rolls **In stock in a storage godown** (Godown A, Godown B).
Rolls **out on the floor** and rolls **located in Running Godown** never count. Equals report
Closing − Out on floor (storage only). Low-stock is evaluated on **current stock only**; a
backdated movement does not create an alert for an earlier day (D-37).

### TC-MIN-001 Set a minimum on the Paper Codes page; who may
- **Status:** 🆕 to build
- **Covers:** AC-10 (setup), D-29, D-30, D-32, E-8
- **Layer:** Manual
- **Given:** Paper Codes page lists ARIHANT rows RT 501 / Delta 730N and RT 502, no minimums.
- **Steps:**
  1. Super admin: Paper Codes → design for RT 501 → Minimum stock (**kg**) = 1500 → Save.
  2. Supervisor: sets RT 502 design minimum = 800 kg → Save.
  3. Super admin: edits RT 502's Delta code on the same vendor and saves.
  4. Operator: tries to log in to the portal.
- **Expected:**
  - Rows show RT 501 minimum 1500 kg, RT 502 minimum 800 kg; values survive a page reload.
  - Step 3 leaves RT 501's minimum at 1500 (editing other paper fields does not wipe minimums).
  - Only **supervisor and super admin** may set minimums (D-32, D-52). Operator cannot (no portal login).

### TC-MIN-002 Minimum value validation
- **Status:** 🆕 to build
- **Covers:** AC-10 (setup), D-34
- **Layer:** Both
- **Given:** RT 501 minimum 1500.
- **Steps:**
  1. Super admin enters −100 → Save.
  2. Super admin enters "abc" → Save.
  3. Super admin enters 1500.5 → Save.
  4. Super admin clears the field → Save.
  5. Super admin sets minimum to **0** → Save (500 kg in storage for RT 501).
- **Expected:**
  - Step 1 refused: "Minimum stock can't be negative" (proposed). Minimum stays 1500.
  - Step 2 refused: "Minimum stock must be a number of kg" (proposed). Minimum stays 1500.
  - Step 3 saved: 1500.5.
  - Step 4 saved: **no minimum** — design not watched (empty box, D-34).
  - Step 5 saved: minimum **0** means alert when the design is **completely empty** in storage (0 kg), not while 500 kg remains.

### TC-MIN-003 Dropping below the minimum raises one alert (floor rolls don't count)
- **Status:** 🆕 to build
- **Covers:** AC-10, D-31
- **Layer:** Both
- **Given:** D1: R8 1000 kg and R9 1000 kg (RT 501) inward to Godown A. Then super admin sets RT 501 minimum 1500 (in store 2000 — no alert).
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
  - It disappears from the Open filter and the badge; it stays visible under **Closed** in the alerts list (D-41).
  - Reports D6: Received 600, Closing 1500.

### TC-MIN-006 Dropping below again after recovery opens a new alert
- **Status:** 🆕 to build
- **Covers:** AC-10, D-35
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
- **Status:** 🆕 to build
- **Covers:** AC-10, D-33
- **Layer:** Both
- **Given:** R43 (RT 502) inward D1 500 kg, Godown A; RT 502 has no minimum.
- **Steps:**
  1. D2, supervisor: sets RT 502 minimum 800.
- **Expected (proposed):**
  - One Low stock alert opens straight away, dated D2: "RT 502 below minimum: 500 kg in store, minimum 800".
  - Same for a design with 0 kg in store: alert "0 kg in store".

### TC-MIN-009 Minimum changed while an alert is open
- **Status:** 🆕 to build
- **Covers:** AC-10
- **Layer:** Auto
- **Given:** state after TC-MIN-004 (RT 501 alert open, in store 900, minimum 1500).
- **Steps:**
  1. D5, super admin: raises RT 501 minimum to 2000.
  2. D5, super admin: lowers RT 501 minimum to 800.
- **Expected:**
  - After step 1: the same alert reads "900 kg in store, minimum 2000"; still one alert.
  - After step 2: 900 ≥ 800 → alert closes itself (D-36): "closed automatically D5 — minimum changed to 800 kg by <user>". No stock or report change.

### TC-MIN-010 Minimum removed while an alert is open
- **Status:** 🆕 to build
- **Covers:** AC-10, D-36
- **Layer:** Auto
- **Given:** state after TC-MIN-004 (RT 501 alert open, in store 900).
- **Steps:**
  1. D5, super admin: clears RT 501's minimum → Save.
  2. D6, operator: sells R9 whole (in store drops further).
- **Expected:**
  - After step 1: the alert closes itself (D-36): "minimum removed by <user>"; badge −1.
  - After step 2: no new alert.

### TC-MIN-011 Opening-stock load does not raise low-stock alerts
- **Status:** 🆕 to build
- **Covers:** AC-10, Opening stock ("minimums set after the load"), OS-3
- **Layer:** Auto
- **Given:** no minimums set. Go-live sheet: RT 501 — 30 rolls totalling 9000 kg in Godown A + 2 rolls 600 kg out in Running Godown; RT 502 — 3 rolls 300 kg in Godown B.
- **Steps:**
  1. Load day L: bulk load the sheet.
  2. L+1, super admin: sets RT 501 minimum 5000 and RT 502 minimum 1000.
- **Expected:**
  - After step 1: alerts page empty; badge 0.
  - After step 2: RT 501 in store 9000 ≥ 5000 → no alert (the 600 on the floor is not counted). RT 502 in store 300 < 1000 → exactly one alert (per TC-MIN-008). Never one alert per roll.

---

## Alerts page (AC-09, AC-10)

### TC-ALERT-001 Who sees the Alerts page
- **Status:** 🆕 to build
- **Covers:** Alerts page, E-8, D-52
- **Layer:** Both
- **Given:** one open Store loss alert (TC-LOSS-001) and one open Low stock alert (TC-MIN-003).
- **Steps:**
  1. Supervisor and super admin each log in to the portal and open Alerts.
  2. Operator: logs in on the tablet; tries the portal; calls the alerts list directly with their token.
- **Expected:**
  - Supervisor and super admin: "Alerts" in the menu with badge 2; both alerts listed.
  - Operator: no alerts anywhere on the tablet; portal login refused (as today); the direct call refused with "You do not have permission to perform this action".

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
- **Status:** 🆕 to build
- **Covers:** Alerts page, D-41, D-28
- **Layer:** Manual
- **Given:** alerts: Store loss R7 (D5, open); Store loss R32 (D5, reviewed D6); Low stock RT 501 (D3, open); Low stock RT 501 (closed D6).
- **Steps:**
  1. Supervisor opens Alerts (default view).
  2. Filters status = Reviewed.
  3. Filters type = Low stock, status = all.
  4. Filters date range D4–D5.
- **Expected:**
  - Columns: type, roll or design, figures, date, status.
  - Step 1 (D-41): **open alerts, newest first** — R7 and RT 501 D3.
  - Step 2: R32 reviewed store-loss alert; closed low-stock uses status **Closed** (not Reviewed).
  - Step 3: both RT 501 alerts.
  - Step 4: R7 and R32 (range inclusive, by **alert date** = movement date, D-28).

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

### TC-ALERT-005 Review with an optional comment
- **Status:** 🆕 to build
- **Covers:** Alerts page, D-38
- **Layer:** Both
- **Given:** open Store loss alert for R7.
- **Steps:**
  1. Supervisor: Mark reviewed with an **empty** comment → confirm.
  2. Supervisor: on another open store-loss alert, Mark reviewed with comment "Checked scale photo".
- **Expected:**
  - Step 1 **succeeds**: status Reviewed, no comment stored (D-38).
  - Step 2: comment stored and shown read-only with reviewer and time.

### TC-ALERT-006 Low-stock: notes allowed, no manual close
- **Status:** 🆕 to build
- **Covers:** AC-10, Alerts page, D-40
- **Layer:** Both
- **Given:** open Low stock alert for RT 501.
- **Steps:**
  1. Supervisor opens it → adds note "Ordered 5 rolls, arriving Friday" → Save.
  2. Supervisor sends a "mark reviewed" for it directly to the server.
- **Expected:**
  - Step 1: note appears on the alert; alert stays **open** (D-40).
  - No Mark reviewed button on low-stock alerts.
  - Step 2 refused: "Low-stock alerts close by themselves once stock is back at the minimum" (proposed).

### TC-ALERT-007 Already reviewed: second review refused
- **Status:** 🆕 to build
- **Covers:** Alerts page (audit), E-2
- **Layer:** Auto
- **Given:** open Store loss alert for R7; supervisor and super admin both have it open.
- **Steps:**
  1. Supervisor marks it reviewed with comment "A".
  2. Super admin, from the stale screen, marks it reviewed with comment "B".
- **Expected:**
  - Step 2 refused: "This alert was already reviewed by <supervisor> on D6 11:00" (proposed).
  - The alert keeps reviewer = supervisor, comment "A". One review record only.

### TC-ALERT-008 Reopen a reviewed store-loss alert
- **Status:** 🆕 to build
- **Covers:** Alerts page, D-39, D-55
- **Layer:** Both
- **Given:** Store loss alert for R7 marked reviewed on D6 (TC-ALERT-004).
- **Steps:**
  1. D7, operator tries Reopen on the tablet (n/a).
  2. D7, supervisor: Reopen → comment "Re-checked with vendor" → confirm.
  3. D7, super admin: Mark reviewed again → comment "OK".
  4. D7, operator token calls Reopen on the server.
- **Expected:**
  - Step 2: alert back to **Open**; history shows review D6 and reopen D7 with comments.
  - Step 3 succeeds. Step 4 refused (operator cannot reopen).
  - Only **supervisor and super admin** may reopen (D-55).

---

## Godown move via portal location edit (AC-06)

### TC-MOVE-001 Untouched roll: A → B
- **Status:** 🆕 fix
- **Covers:** AC-06, D-42; I-1
- **Layer:** Both
- **Given:** R4 (RT 502) inward D1 700 kg, Godown A; no other movement.
- **Steps:**
  1. D3, supervisor on portal: Rolls → R4 → Edit → Location: Godown B → Save.
- **Expected:**
  - R4: In stock, 700 kg, Godown B.
  - History: Received 700 kg (D1, Godown A); **D3** row "Moved to another godown · Godown B" (D-42).
  - ERPNext: Stock Entry (Material Transfer) 700 kg Godown A → Godown B, dated D3 — not a receipt re-post.
  - Reports D1 and D3: unchanged (Received 700 on D1, Closing 700).

### TC-MOVE-002 Roll with history: A → B
- **Status:** 🆕 fix
- **Covers:** AC-06, D-42; I-1, I-6
- **Layer:** Both
- **Given:** R51 (RT 502) inward D1 1000, Godown A; D2 out (weighed 1000); D3 return 600 to Godown A.
- **Steps:**
  1. D4, supervisor on portal: R51 → Edit → Location: Godown B → Save.
- **Expected:**
  - R51: In stock, 600 kg, Godown B.
  - History: prior rows unchanged; **new** D4 row "Moved to another godown · Godown B".
  - ERPNext: Stock Entry (Material Transfer) 600 kg Godown A → Godown B, dated D4. Stock as of D3 still shows Godown A.
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
- **Status:** ✅ today (D-43)
- **Covers:** AC-06, AC-10, D-43
- **Layer:** Both
- **Given:** R53 (RT 501) inward D1 1000, Godown A, In stock. RT 501 minimum 1500; only R53 in storage (1000 in store).
- **Steps:**
  1. D2, supervisor: R53 → Edit → Location: Running Godown → Save.
- **Expected:**
  - **Allowed** (as today): R53 In stock, 1000 kg, location Running Godown; history includes "Moved to another godown · Running Godown" (D-42).
  - For minimum stock (D-31, D-43): roll does **not** count as in storage — RT 501 in store becomes 0 → Low stock alert if minimum set.
  - Outward on the tablet remains the normal way to issue to the floor; portal location edit is an allowed shortcut for corrections.
