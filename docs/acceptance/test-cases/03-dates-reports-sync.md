# Test cases 03: multi-day timelines, date rules, offline sync and reports

Part of the acceptance test catalogue for
[2026-11-04-inventory-acceptance.md](../2026-11-04-inventory-acceptance.md). That document is
the authority for decisions, for the 🆕/🔶 marks and for invariants I-1 to I-6. Refusal messages
are copied exactly from the code (`erpnext/royal_touche/royal_touche/dates.py`, `movements.py`,
`sync.py`, `api/portal_reports.py`). Report column names are copied from
`report_logic/consumption.py`, `report_logic/daily_status.py` and the portal pages in
`frontend/src/features/reports/`.

**Not covered here** (they have their own sections): each movement on its own (01), partial
return to vendor / partial sale / store loss / low stock / alerts / godown move (02), opening
stock, portal corrections, delete, roles (04). Cases here reuse those movements to prove dates,
sync and reports.

## Conventions for every case

- **Setup.** The shared setup from the acceptance document: Godown A and Godown B (storage),
  Running Godown (production floor); material **Base paper** (material code `BASE-PAPER`);
  vendor **ARIHANT** with designs **RT 501 / Delta 730N** (RT code `RT 501`, Delta code `730N`)
  and **RT 502** (RT code `RT 502`, no Delta code); buyer **Direct Sale**; lot (challan)
  **CH-100** from ARIHANT; users operator (tablet), supervisor (portal), admin.
- **Rolls.** Every case starts from an empty stock with only its own **Given**. Roll numbers are
  chosen so they don't collide with the golden dataset (R1–R13): timelines use R13–R26, date
  cases R40–R49, sync cases R50–R59 and R70–R77, report cases R60–R69.
- **Days and clock.** D1, D2… are IST calendar days; times are IST. Timelines run on a
  **controlled clock**: the server's "now" is set to the time of each step. Movements go through
  the same API the tablet uses (`/api/method/royal_touche.api.sync.batch`). When D-days need to
  be real dates (month end, year end, week boundaries), the case gives them.
- **Refusals.** A refused action returns the quoted message. Through sync the item comes back
  `status: failed` with `error` = the message, plus `code` and `reason` in brackets, e.g.
  *(409 conflict)*. "Nothing is posted" means no Roll Movement, no ERPNext stock document, and
  the roll unchanged (status, kg, godown, ledger).
- **Report figures** come from the consumption report (portal: Reports → Consumption) by
  material (Base paper) and by design. Per-day tables use these columns:

  | Short | Screen label | CSV header |
  |---|---|---|
  | Open | Opening | Opening (kg) |
  | Recv | Received | Received (kg) |
  | Cons | Consumed | Consumed (kg) |
  | RtV | Returned to vendor | Returned to vendor (kg) |
  | Sold | Sold | Sold (kg) |
  | Adj | Adjusted | Adjusted (kg) (signed: − is down) |
  | Close | Closing | Closing (kg) |
  | Floor | Out on floor | Out on floor at close (kg) |

  **Store loss** (AC-09, 🆕) is 0 in every case here and left out of the tables. When it is built
  it joins the equation (TC-RPT-021).
- **Every per-day table is checked with I-2:** Open + Recv − Cons − RtV − Sold + Adj = Close.
  Next day's Open = this day's Close. Floor is part of Close, never more than it.
- **Checked after every day in every timeline, not repeated below:**
  - I-1: ERPNext batch balance **as of the end of that day** = the roll's kg in the roll's
    godown (0 for a finished roll), and `ledger_mismatches()` is empty after the last step.
  - I-3: no negative figure in any report, any day.
  - I-4: a finished roll has 0 kg and no godown.
  - I-6: the daily roll report for each day with a movement says the same as the roll's
    history row (status, final kg, location).
- **History text** is the portal's one-line description of each movement:
  `Received 1000 kg` · `Issued out 1000 kg to Running Godown` ·
  `Returned 600 kg to Godown A · 400 kg used` · `Consumed — 1000 kg used up` ·
  `Returned to vendor ARIHANT — 500 kg` · `Sold — 800 kg` · `Corrected by 10 kg`.
- **Status** describes the behaviour. The **controlled-clock timeline harness** in "How we
  test" layer 1 does not exist yet: today's automated report tests replay fixed September and
  October fixtures (`tests/test_reports.py`). So every TC-TL case also needs that harness to be
  built 🆕, even where the behaviour is ✅.

---

## Multi-day timelines

### TC-TL-001 Long gap: in, out 11 days later, return, sell the rest (T-1)
- **Status:** ✅ today
- **Covers:** T-1, AC-03, AC-08a · I-1–I-6
- **Layer:** Auto
- **Given:** R14, RT 501, Base paper, nothing else in stock. D1 is a Monday, and D1–D28 fall in
  one calendar month.
- **Steps:**
  1. D1 09:00 Operator registers R14: 1000 kg, Godown A, lot CH-100. Syncs.
  2. D12 10:00 Operator issues R14 out to Running Godown, issued to "Machine 2". Syncs.
  3. D20 17:00 Operator returns R14 at 400 kg. Syncs.
  4. D27 11:00 Operator sells R14 to Direct Sale, Savio bill SB-27, vehicle GJ05AB1234. Syncs.
  5. Harness: after every day D1–D28, reads the daily report (by material and by design), the
     daily roll report, and ERPNext batch balance as of that day.
- **Expected:** Base paper and RT 501 show the same figures every day.

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R14 at end of day |
  |---|---|---|---|---|---|---|---|---|---|
  | D1 | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 0 | In stock · 1000 · Godown A |
  | D2–D11, each | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 0 | unchanged |
  | D12 | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | Out · 1000 · Running Godown |
  | D13–D19, each | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | unchanged |
  | D20 | 1000 | 0 | **600** | 0 | 0 | 0 | 400 | 0 | In stock · 400 · **Godown A** |
  | D21–D26, each | 400 | 0 | 0 | 0 | 0 | 0 | 400 | 0 | unchanged |
  | D27 | 400 | 0 | 0 | 0 | **400** | 0 | 0 | 0 | Sold · 0 · no godown |
  | D28 | no row (all figures 0) | | | | | | | | |

  - ERPNext as of each day: D1–D11 1000 in Godown A; D12–D19 1000 in Running Godown; D20–D26
    400 in Godown A; D27 on 0. Documents: Purchase Receipt (D1), Material Transfer A→Running
    (D12), Material Issue 600 + Material Transfer 400 Running→A (D20), Delivery Note 400 (D27).
  - Daily roll report: one row on D1 (Received), D12 (Outward, Out, 1000, Running Godown),
    D20 (Inward, In stock, Final weight 400, Weight moved 400, Weight used 600, Godown A),
    D27 (Sold, Sold, Final weight 0, Weight moved 400, no location). Every other day: "No rolls
    moved on that date".
  - Weekly (Monday–Sunday):

    | Week | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
    |---|---|---|---|---|---|---|---|---|
    | D1–D7 | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 0 |
    | D8–D14 | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 |
    | D15–D21 | 1000 | 0 | 600 | 0 | 0 | 0 | 400 | 0 |
    | D22–D28 | 400 | 0 | 0 | 0 | 400 | 0 | 0 | 0 |

  - Monthly: Open 0, Recv 1000, Cons 600, Sold 400, Close 0, Floor 0.
  - Roll detail CSV for D15–D21: one line, Date D20, R14, Consumed (kg) 600, Left on roll (kg)
    400, Used at Running Godown, Issued to Machine 2.
  - History: 4 rows: `Received 1000 kg` · `Issued out 1000 kg to Running Godown` ·
    `Returned 400 kg to Godown A · 600 kg used` · `Sold — 400 kg`.

### TC-TL-002 Month end: received in October, used in November (T-2)
- **Status:** ✅ today
- **Covers:** T-2, AC-03 · I-1–I-6
- **Layer:** Auto
- **Given:** R13, RT 501 (golden dataset roll). Dates are real: Fri 30 Oct 2026 to Tue
  3 Nov 2026.
- **Steps:**
  1. 30 Oct 10:00 Operator registers R13: 900 kg, Godown A. Syncs.
  2. 2 Nov 09:00 Operator issues R13 out to Running Godown. Syncs.
  3. 3 Nov 16:00 Operator returns R13 at 500 kg. Syncs.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R13 |
  |---|---|---|---|---|---|---|---|---|---|
  | 30 Oct | 0 | 900 | 0 | 0 | 0 | 0 | 900 | 0 | In stock · 900 · Godown A |
  | 31 Oct | 900 | 0 | 0 | 0 | 0 | 0 | 900 | 0 | unchanged |
  | 1 Nov | 900 | 0 | 0 | 0 | 0 | 0 | 900 | 0 | unchanged |
  | 2 Nov | 900 | 0 | 0 | 0 | 0 | 0 | 900 | 900 | Out · 900 · Running Godown |
  | 3 Nov | 900 | 0 | 400 | 0 | 0 | 0 | 500 | 0 | In stock · 500 · Godown A |

  | Period | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | October (1–31 Oct) | 0 | 900 | 0 | 0 | 0 | 0 | 900 | 0 |
  | November (1–30 Nov) | 900 | 0 | 400 | 0 | 0 | 0 | 500 | 0 |
  | Week 26 Oct–1 Nov | 0 | 900 | 0 | 0 | 0 | 0 | 900 | 0 |
  | Week 2–8 Nov | 900 | 0 | 400 | 0 | 0 | 0 | 500 | 0 |

  - October's Closing (900) = November's Opening (900).
  - ERPNext as of 31 Oct: 900 kg of R13 in Godown A.

### TC-TL-003 Several rolls of one design, mixed events on one day (T-3)
- **Status:** 🆕 to build (the partial sale of R11 needs AC-08b; the rest works today)
- **Covers:** T-3, AC-04, AC-05, AC-08b · I-1–I-6
- **Layer:** Auto
- **Given:** RT 502 rolls R10, R11, R12 (golden dataset rolls). Nothing else in stock.
- **Steps:**
  1. D1 Operator registers R10 1000 kg Godown A, R11 800 kg Godown A, R12 600 kg Godown B. Syncs.
  2. D3 10:00 Operator issues R10 out to Running Godown.
  3. D3 11:00 Operator sells **300 kg** of R11 to Direct Sale (partial sale).
  4. D3 12:00 Operator returns R12 to the vendor (whole roll). Syncs.
  5. D5 16:00 Operator returns R10 at 700 kg. Syncs.
- **Expected:** RT 502 and Base paper show the same figures.

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | D1 | 0 | 2400 | 0 | 0 | 0 | 0 | 2400 | 0 |
  | D2 | 2400 | 0 | 0 | 0 | 0 | 0 | 2400 | 0 |
  | D3 | 2400 | 0 | 0 | 600 | 300 | 0 | 1500 | 1000 |
  | D4 | 1500 | 0 | 0 | 0 | 0 | 0 | 1500 | 1000 |
  | D5 | 1500 | 0 | 300 | 0 | 0 | 0 | 1200 | 0 |

  **Design = sum of its rolls**, D3:

  | Roll | Open | Cons | RtV | Sold | Close | Floor | At end of D3 |
  |---|---|---|---|---|---|---|---|
  | R10 | 1000 | 0 | 0 | 0 | 1000 | 1000 | Out · 1000 · Running Godown |
  | R11 | 800 | 0 | 0 | 300 | 500 | 0 | In stock · 500 · Godown A |
  | R12 | 600 | 0 | 600 | 0 | 0 | 0 | Returned to vendor · 0 · no godown |
  | **RT 502** | **2400** | **0** | **600** | **300** | **1500** | **1000** | |

  D5:

  | Roll | Open | Cons | Close | Floor | At end of D5 |
  |---|---|---|---|---|---|
  | R10 | 1000 | 300 | 700 | 0 | In stock · 700 · Godown A |
  | R11 | 500 | 0 | 500 | 0 | unchanged |
  | R12 | 0 | 0 | 0 | 0 | unchanged |
  | **RT 502** | **1500** | **300** | **1200** | **0** | |

  - Daily roll report D3: 3 rows (R10 Outward / Out / 1000; R11 Sold / In stock / 500, Weight
    moved 300; R12 Returned to vendor / 0). "3 rolls moved".
  - ERPNext D3: Material Transfer 1000 (R10), Delivery Note 300 (R11), Purchase Return 600 (R12).
- **Note:** today a sale always takes the whole roll: step 3 sells 800, so D3 Sold = 800,
  Close = 1000, D5 Close = 700, and R11 ends Sold · 0.

### TC-TL-004 Backdated entry: outward recorded the next day (T-4)
- **Status:** ✅ today
- **Covers:** T-4 · I-1–I-6
- **Layer:** Auto
- **Given:** R15, RT 501, 1000 kg in Godown A, received D1. Nothing else in stock.
- **Steps:**
  1. D7 20:00 Harness reads the D7 report: Close 1000, Floor 0.
  2. D8 10:00 Operator issues R15 out to Running Godown and picks the date **yesterday (D7)**.
     Syncs.
  3. D9 15:00 Operator returns R15 at 800 kg. Syncs.
  4. Harness re-reads D1–D9.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R15 |
  |---|---|---|---|---|---|---|---|---|---|
  | D1 | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 0 | In stock · 1000 · Godown A |
  | D2–D6, each | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 0 | unchanged |
  | D7 | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | **1000** (was 0 before step 2) | Out · 1000 · Running Godown |
  | D8 | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | unchanged |
  | D9 | 1000 | 0 | 200 | 0 | 0 | 0 | 800 | 0 | In stock · 800 · Godown A |

  - The outward movement is dated D7. ERPNext's Material Transfer is posted **on D7**, so the
    ledger stays in date order: Purchase Receipt D1 → Transfer D7 → Issue + Transfer D9.
    ERPNext as of end of D7: 1000 in Running Godown.
  - Daily roll report D7: R15, Last movement "Outward", Final status "Out", Final weight 1000,
    Last location Running Godown. D8: "No rolls moved on that date".
  - Weekly D1–D7: Open 0, Recv 1000, Close 1000, Floor 1000.
- **Note:** "Last movement recorded at" on the D7 row shows **D8 10:00**. It is the time the
  server wrote the row, not the movement's date. That is correct but may surprise readers.

### TC-TL-005 Offline overnight: return saved in the evening, synced next morning (T-5)
- **Status:** ✅ today
- **Covers:** T-5, E-1 · I-1–I-6
- **Layer:** Auto
- **Given:** R16, RT 502, 1000 kg received D1 in Godown A, issued out to Running Godown D8.
- **Steps:**
  1. D9 18:00 Tablet loses network.
  2. D9 19:30 Operator returns R16 at 750 kg on the tablet (queued: date D9 19:30, saved-on
     D9 19:30).
  3. D9 21:00 Harness reads the D9 report (before the sync).
  4. D10 08:15 Tablet is back online and syncs the queue.
  5. D10 08:15 The response is lost. The tablet resends the same item (same `client_id`).
  6. Harness re-reads D8–D10.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R16 |
  |---|---|---|---|---|---|---|---|---|---|
  | D8 | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | Out · 1000 · Running Godown |
  | D9 (step 3, before sync) | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | Out · 1000 |
  | D9 (after sync) | 1000 | 0 | 250 | 0 | 0 | 0 | 750 | 0 | In stock · 750 · Godown A |
  | D10 | 750 | 0 | 0 | 0 | 0 | 0 | 750 | 0 | unchanged |

  - Step 4: item `status: ok`. The movement is dated **D9 19:30**, saved-on (recorded_at) D9
    19:30. ERPNext Material Issue 250 and Transfer 750 are posted D9 19:30.
  - Step 5: `status: ok`, with the **same** movement as step 4. Still exactly one return row.
    No second ERPNext document. The Sync Log has two entries.
  - Daily roll report D9: R16 Inward, In stock, Final weight 750, Weight used 250. D10:
    "No rolls moved on that date".
- **Note:** "Last movement recorded at" on the D9 row shows D10 08:15 (when the server got it),
  not 19:30 (when the operator saved it on the tablet). 🔶 Team to say which time the report
  should show.

### TC-TL-006 Late sync with an earlier date, refused (T-6)
- **Status:** ✅ today
- **Covers:** T-6, E-2 · I-1–I-6
- **Layer:** Auto
- **Given:** R17, RT 502, 800 kg received D1 in Godown A. Tablets A and B are logged in.
- **Steps:**
  1. D9 10:00 Tablet B issues R17 out to Running Godown. Tablet A pulls and shows R17 as Out.
  2. D10 13:00 Tablet A loses network.
  3. D10 14:00 On tablet A, operator 1 returns R17 at 600 kg (queued, dated D10).
  4. D10 15:00 On tablet B, operator 2 records the same physical return: 600 kg. Synced at once.
  5. D11 11:00 Tablet B sells R17 to Direct Sale. Synced at once.
  6. D11 18:00 Tablet A comes online and syncs its queued return dated D10.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R17 |
  |---|---|---|---|---|---|---|---|---|---|
  | D1 | 0 | 800 | 0 | 0 | 0 | 0 | 800 | 0 | In stock · 800 · Godown A |
  | D2–D8, each | 800 | 0 | 0 | 0 | 0 | 0 | 800 | 0 | unchanged |
  | D9 | 800 | 0 | 0 | 0 | 0 | 0 | 800 | 800 | Out · 800 · Running Godown |
  | D10 | 800 | 0 | 200 | 0 | 0 | 0 | 600 | 0 | In stock · 600 · Godown A |
  | D11 | 600 | 0 | 0 | 0 | 600 | 0 | 0 | 0 | Sold · 0 · no godown |

  - Step 6: refused, "This roll has already been sold" *(409 conflict)*. Nothing is posted:
    the table above does not change, R17 has one return row, ERPNext has no new document. The
    Sync Log records 1 failed.
  - Later movements for R17 in the same batch come back `skipped` with reason
    `dependency_failed`.
  - Variant: if step 5 had not happened, step 6 is refused with "This roll is not currently
    out, so it cannot be returned" *(409 conflict)*.

### TC-TL-007 Inward and outward on the same day
- **Status:** ✅ today
- **Covers:** AC-01, AC-03 · I-1–I-6
- **Layer:** Auto
- **Given:** R18, RT 501. Nothing else in stock.
- **Steps:**
  1. D1 09:00 Operator registers R18: 1000 kg, Godown A. Syncs.
  2. D1 15:00 Operator issues R18 out to Running Godown. Syncs.
  3. D2 17:00 Operator returns R18 at 900 kg. Syncs.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R18 |
  |---|---|---|---|---|---|---|---|---|---|
  | D1 | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 1000 | Out · 1000 · Running Godown |
  | D2 | 1000 | 0 | 100 | 0 | 0 | 0 | 900 | 0 | In stock · 900 · Godown A |

  - ERPNext D1: Purchase Receipt into Godown A at 09:00, Transfer A→Running at 15:00. As of
    end of D1: 1000 in Running Godown, 0 in Godown A.
  - Daily roll report D1: **one** row for R18. Last movement "Outward", Movements that day 2,
    Final status "Out", Final weight 1000, Last location Running Godown, Received date D1.

### TC-TL-008 Inward, outward and return on the same day
- **Status:** ✅ today
- **Covers:** AC-03 · I-1–I-6
- **Layer:** Auto
- **Given:** R19, RT 501. Nothing else in stock.
- **Steps:**
  1. D1 09:00 Operator registers R19: 500 kg, Godown A.
  2. D1 11:00 Operator issues R19 out to Running Godown.
  3. D1 17:00 Operator returns R19 at 450 kg. Syncs (all three in one batch, in this order).
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R19 |
  |---|---|---|---|---|---|---|---|---|---|
  | D1 | 0 | 500 | 50 | 0 | 0 | 0 | 450 | 0 | In stock · 450 · Godown A |
  | D2 | 450 | 0 | 0 | 0 | 0 | 0 | 450 | 0 | unchanged |

  - Daily roll report D1: one row. Last movement "Inward", Movements that day 3, Final weight
    450, Weight moved 450, Weight used 50, Last location Godown A.
  - Roll detail CSV D1: one line, Consumed (kg) 50, Left on roll (kg) 450, Used at Running
    Godown.

### TC-TL-009 Out at the end of one month, back weeks later in the next
- **Status:** 🔶 value to confirm (the month that gets the consumption)
- **Covers:** AC-03, T-2 · I-1–I-6
- **Layer:** Auto
- **Given:** R20, RT 501. Real dates: Tue 1 Sep 2026 to Wed 7 Oct 2026.
- **Steps:**
  1. 1 Sep Operator registers R20: 1000 kg, Godown A.
  2. 21 Sep Operator issues R20 out to Running Godown.
  3. 7 Oct Operator returns R20 at 650 kg.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R20 |
  |---|---|---|---|---|---|---|---|---|---|
  | 1 Sep | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 0 | In stock · 1000 · Godown A |
  | 2–20 Sep, each | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 0 | unchanged |
  | 21 Sep | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | Out · 1000 · Running Godown |
  | 22 Sep–6 Oct, each | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | unchanged |
  | 7 Oct | 1000 | 0 | 350 | 0 | 0 | 0 | 650 | 0 | In stock · 650 · Godown A |

  | Period | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | September | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 1000 |
  | October | 1000 | 0 | 350 | 0 | 0 | 0 | 650 | 0 |
  | Week 21–27 Sep | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 |
  | Week 28 Sep–4 Oct (no movement) | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 |
  | Week 5–11 Oct | 1000 | 0 | 350 | 0 | 0 | 0 | 650 | 0 |

  - The week with no movement still shows a row (it has stock).
  - Roll detail CSV for September: no lines, so the "Roll detail CSV" button is disabled. For
    October: one line dated 2026-10-07, Consumed (kg) 350.
- **Note:** consumption is counted on the **return day** (as in Node, AC-03 "team to confirm").
  So September shows 1000 kg out on the floor and 0 consumed, and all 350 kg lands in October,
  even if the paper was used in September. 🔶 Team to confirm this is acceptable for month-end
  reporting.

### TC-TL-010 Return, inward and sale of one design on the same day (design = sum of rolls)
- **Status:** ✅ today
- **Covers:** T-3, AC-03, AC-05 · I-1–I-6
- **Layer:** Auto
- **Given:** RT 501 rolls R21, R22, R23. Nothing else in stock.
- **Steps:**
  1. D1 Operator registers R21 1000 kg Godown A and R22 800 kg Godown A.
  2. D2 Operator issues R21 out to Running Godown.
  3. D5 10:00 Operator registers R23: 700 kg, Godown B.
  4. D5 12:00 Operator sells R22 (whole roll) to Direct Sale.
  5. D5 16:00 Operator returns R21 at 600 kg.
- **Expected:** RT 501:

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | D1 | 0 | 1800 | 0 | 0 | 0 | 0 | 1800 | 0 |
  | D2 | 1800 | 0 | 0 | 0 | 0 | 0 | 1800 | 1000 |
  | D3–D4, each | 1800 | 0 | 0 | 0 | 0 | 0 | 1800 | 1000 |
  | D5 | 1800 | 700 | 400 | 0 | 800 | 0 | 1300 | 0 |

  D5 per roll:

  | Roll | Open | Recv | Cons | Sold | Close | At end of D5 |
  |---|---|---|---|---|---|---|
  | R21 | 1000 | 0 | 400 | 0 | 600 | In stock · 600 · Godown A |
  | R22 | 800 | 0 | 0 | 800 | 0 | Sold · 0 · no godown |
  | R23 | 0 | 700 | 0 | 0 | 700 | In stock · 700 · Godown B |
  | **RT 501** | **1800** | **700** | **400** | **800** | **1300** | |

  - Base paper shows the same figures as RT 501.
  - Daily roll report D5: 3 rows, sorted R21, R22, R23. "3 rolls moved".

### TC-TL-011 Financial year end: 31 March to 1 April
- **Status:** ✅ today (reports); 🔶 value to confirm (a financial-year view)
- **Covers:** T-2 · I-1–I-5
- **Layer:** Auto
- **Given:** R24, RT 502. Real dates: Mon 30 Mar 2026 to Thu 2 Apr 2026. ERPNext Fiscal Years
  2025-2026 and 2026-2027 exist.
- **Steps:**
  1. 30 Mar Operator registers R24: 1000 kg, Godown A.
  2. 31 Mar Operator issues R24 out to Running Godown.
  3. 1 Apr Operator returns R24 at 700 kg.
  4. 2 Apr Operator sells R24 (700 kg) to Direct Sale.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor | R24 |
  |---|---|---|---|---|---|---|---|---|---|
  | 30 Mar | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 0 | In stock · 1000 · Godown A |
  | 31 Mar | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 | Out · 1000 · Running Godown |
  | 1 Apr | 1000 | 0 | 300 | 0 | 0 | 0 | 700 | 0 | In stock · 700 · Godown A |
  | 2 Apr | 700 | 0 | 0 | 0 | 700 | 0 | 0 | 0 | Sold · 0 · no godown |

  | Period | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | March 2026 | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 1000 |
  | April 2026 | 1000 | 0 | 300 | 0 | 700 | 0 | 0 | 0 |
  | Week 30 Mar–5 Apr | 0 | 1000 | 300 | 0 | 700 | 0 | 0 | 0 |
  | FY 2025-26 (API, 2025-04-01 to 2026-03-31) | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 1000 |
  | FY 2026-27 (API, 2026-04-01 to 2027-03-31) | 1000 | 0 | 300 | 0 | 700 | 0 | 0 | 0 |

  - ERPNext: the 1 Apr and 2 Apr documents post into Fiscal Year 2026-2027 without error.
- **Note:** the portal offers only Daily, Weekly and Monthly. A financial-year figure is only
  available through the API with a custom range. 🔶 Team to say if a yearly (April–March) view
  is wanted. The app does not create ERPNext Fiscal Years. ERPNext's daily scheduler creates
  the next one 3 days before year end, **only if the scheduler is running**. Without it, every
  movement on 1 April fails. Add "next Fiscal Year exists" to the March checklist.

### TC-TL-012 A week that spans two months
- **Status:** ✅ today
- **Covers:** I-2, I-5
- **Layer:** Auto
- **Given:** RT 502 rolls R25, R26. Real dates: week Mon 28 Sep 2026 to Sun 4 Oct 2026.
  Nothing else in stock.
- **Steps:**
  1. 29 Sep Operator registers R25: 1000 kg, Godown B.
  2. 30 Sep Operator issues R25 out to Running Godown.
  3. 1 Oct Operator registers R26: 500 kg, Godown A.
  4. 2 Oct Operator returns R25 at 800 kg.
  5. 3 Oct Operator returns R26 to the vendor (whole roll).
  6. Supervisor opens Reports → Consumption → Weekly, picks any day 28 Sep–4 Oct.
- **Expected:** RT 502 and Base paper:

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | 28 Sep | no row (no stock, no movement) | | | | | | | |
  | 29 Sep | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 0 |
  | 30 Sep | 1000 | 0 | 0 | 0 | 0 | 0 | 1000 | 1000 |
  | 1 Oct | 1000 | 500 | 0 | 0 | 0 | 0 | 1500 | 1000 |
  | 2 Oct | 1500 | 0 | 200 | 0 | 0 | 0 | 1300 | 0 |
  | 3 Oct | 1300 | 0 | 0 | 500 | 0 | 0 | 800 | 0 |
  | 4 Oct | 800 | 0 | 0 | 0 | 0 | 0 | 800 | 0 |
  | **Week 28 Sep–4 Oct** | **0** | **1500** | **200** | **500** | **0** | **0** | **800** | **0** |
  | September (1–30 Sep) | 0 | 1000 | 0 | 0 | 0 | 0 | 1000 | 1000 |
  | October (1–31 Oct) | 1000 | 500 | 200 | 500 | 0 | 0 | 800 | 0 |

  - The page shows the range "2026-09-28 to 2026-10-04".
  - Week = sum of its 7 days (I-5). Week Open = 28 Sep Open; week Close and Floor = 4 Oct's.
  - R25 ends In stock · 800 · **Godown B** (back where it went out from). R26 ends Returned to
    vendor · 0.

---

## Date rules

The rule (`dates.check_operator_date`): an outward, return, consume, return to vendor or sale
may be dated **today or yesterday**. "Today" is the IST day the movement was **saved on the
tablet** (`recorded_at`). Without a recorded_at (an online portal call), "today" is the server's
IST today. Nothing may be dated after the server's IST today.

Clock for all TC-DATE cases unless stated: server now = **Wed 4 Nov 2026 10:00 IST**. So
today = 4 Nov, yesterday = 3 Nov, two days ago = 2 Nov, tomorrow = 5 Nov.

### TC-DATE-001 Today is allowed
- **Status:** ✅ today
- **Covers:** AC-03, T-4 · I-2
- **Layer:** Both
- **Given:** R40, RT 501, 1000 kg in Godown A, received 1 Nov.
- **Steps:**
  1. Operator issues R40 out to Running Godown, date left as today (4 Nov 10:00). Syncs.
- **Expected:** item `ok`. Movement dated 4 Nov 10:00. R40 Out · 1000 · Running Godown. Report
  4 Nov: Close 1000, Floor 1000. ERPNext transfer posted 4 Nov 10:00.

### TC-DATE-002 Yesterday is allowed and lands on yesterday
- **Status:** ✅ today
- **Covers:** T-4 · I-2
- **Layer:** Both
- **Given:** R41, RT 501, 1000 kg, received 1 Nov, out on Running Godown since 2 Nov.
- **Steps:**
  1. Operator returns R41 at 700 kg, picks **yesterday** (3 Nov). Syncs.
  2. Supervisor records the same kind of entry for another roll through the portal (no
     recorded_at), dated 3 Nov.
- **Expected:**
  - Both accepted. R41's return is dated 3 Nov.
  - Report 3 Nov: Cons 300, Close 700, Floor 0. Report 4 Nov: Open 700, Cons 0, Close 700.
  - Without recorded_at (step 2) the server's today (4 Nov) is the reference: 3 Nov allowed.

### TC-DATE-003 Two days ago is refused
- **Status:** ✅ today
- **Covers:** AC-01, AC-03 · I-1
- **Layer:** Both
- **Given:** R42, out on Running Godown since 1 Nov, 1000 kg.
- **Steps:**
  1. Operator returns R42 at 600 kg dated 2 Nov (saved on 4 Nov). Syncs.
  2. Same through the portal without recorded_at.
- **Expected:** both refused: "The date must be today or yesterday" *(400 validation)*.
  Nothing is posted. R42 stays Out · 1000 · Running Godown. Report 2 Nov unchanged.

### TC-DATE-004 A future date is refused, for every movement type
- **Status:** ✅ today
- **Covers:** AC-01 · I-1
- **Layer:** Auto
- **Given:** R43, RT 501, 1000 kg in Godown A.
- **Steps:**
  1. Operator issues R43 out dated 5 Nov 09:00 (saved-on 4 Nov).
  2. Same with saved-on also 5 Nov 09:00.
  3. Physical count (ADJUSTMENT) on R43 to 990 dated 5 Nov, remarks "count".
  4. Add weight back (IN) 10 kg on R43 dated 5 Nov.
- **Expected:** all four refused: "The date cannot be in the future" *(400 validation)*. The
  future-date check runs first, so step 2 gets this message too, not the saved-on one. Nothing
  is posted.

### TC-DATE-005 Offline: saved in the evening, synced next morning
- **Status:** ✅ today
- **Covers:** T-5 · I-1, I-2
- **Layer:** Both
- **Given:** R44, RT 502, 1000 kg, out on Running Godown since 2 Nov. Clock: tablet offline
  3 Nov evening. Server now at sync = 4 Nov 08:15.
- **Steps:**
  1. 3 Nov 19:30 (offline) Operator returns R44 at 600 kg, date today (3 Nov 19:30).
  2. 4 Nov 00:10 (still offline) Operator returns R45 (out since 2 Nov, 500 kg) at 450 kg,
     picks **yesterday** (3 Nov 23:30).
  3. 4 Nov 08:15 Tablet syncs both.
- **Expected:**
  - Both `ok`. R44 dated 3 Nov 19:30, saved-on 3 Nov 19:30. R45 dated 3 Nov 23:30, saved-on
    4 Nov 00:10.
  - Report 3 Nov: Cons 400 (R44) + 50 (R45) = 450. Report 4 Nov: no consumption from these.
  - Step 1 passes because "today" is the **saved-on** day (3 Nov), not the sync day.

### TC-DATE-006 An old offline queue, or a tablet whose clock is behind
- **Status:** 🔶 value to confirm (an upper limit on how old a queued movement may be)
- **Covers:** T-5, AC-01 · I-2
- **Layer:** Auto
- **Given:** R46, RT 501, 1000 kg out on Running Godown since 1 Oct.
- **Steps:**
  1. Tablet saved a return of R46 at 700 kg on **27 Oct** (date 27 Oct, saved-on 27 Oct)
     and stayed offline until now (4 Nov 10:00). It syncs.
  2. Variant: the tablet's clock is 8 days slow. The operator returns R46 "today" on 4 Nov.
     The tablet sends date 27 Oct, saved-on 27 Oct.
- **Expected (doc's rule, to confirm):** a movement older than the agreed limit (proposed:
  saved-on more than **7 days** before the server's today) is refused with a clear message
  (proposed wording: "This entry was saved more than 7 days ago — check the tablet's date and
  enter it again"). Nothing is posted.
- **Note:** today both steps are **accepted**: 27 Oct gets Cons 300 and every report from
  27 Oct onwards changes, 8 days after the fact. The server cannot tell an old queue from a
  slow clock, because both send the same saved-on time. The rule only checks the date against
  the saved-on day the tablet reports.

### TC-DATE-007 Movements just before and just after midnight IST land on their own days
- **Status:** ✅ today
- **Covers:** E-7 · I-2, I-6
- **Layer:** Auto
- **Given:** R47 and R48, RT 501, 1000 kg each, both out on Running Godown since 2 Nov. Server
  now 4 Nov 10:00.
- **Steps:**
  1. Return R47 at 900 kg with date `2026-11-03T18:29:00Z` (= 3 Nov **23:59** IST).
  2. Return R48 at 800 kg with date `2026-11-03T18:31:00Z` (= 4 Nov **00:01** IST).
  3. Variant: a date-only value `2026-11-03` for a third roll R49 (out since 2 Nov, 1000 kg,
     returned at 950).
  4. Variant: a return at exactly `2026-11-03T18:30:00Z` (= 4 Nov 00:00:00 IST) for R49
     instead of step 3.
- **Expected:**

  | Roll | IST time | Report day | Daily roll report | Detail CSV Date | ERPNext posting |
  |---|---|---|---|---|---|
  | R47 | 3 Nov 23:59 | 3 Nov: Cons 100 | listed on 3 Nov only | 2026-11-03 | 3 Nov 23:59:00 |
  | R48 | 4 Nov 00:01 | 4 Nov: Cons 200 | listed on 4 Nov only | 2026-11-04 | 4 Nov 00:01:00 |
  | R49 (step 3) | 3 Nov 00:00 | 3 Nov: Cons 50 | 3 Nov | 2026-11-03 | 3 Nov 00:00:00 |
  | R49 (step 4) | 4 Nov 00:00 | 4 Nov: Cons 50 | 4 Nov | 2026-11-04 | 4 Nov 00:00:00 |

  - A day runs from 00:00:00 IST (included) to 24:00 IST (excluded), whatever zone the device
    or the server is in.

### TC-DATE-008 Tablet clock ahead of the server
- **Status:** ✅ today
- **Covers:** AC-01 · I-1
- **Layer:** Auto
- **Given:** R43 (TC-DATE-004), in stock, 1000 kg, Godown A.
- **Steps:**
  1. Tablet clock is 1 day ahead (shows 5 Nov). Operator issues R43 out "today": date 5 Nov,
     saved-on 5 Nov.
  2. Tablet clock is 1 day ahead. Operator picks "yesterday" (= 4 Nov on the tablet): date
     4 Nov, saved-on 5 Nov.
  3. Server now 3 Nov 23:58. Tablet clock is 5 minutes ahead (4 Nov 00:03): date 4 Nov 00:03,
     saved-on 4 Nov 00:03.
  4. Server now 4 Nov 10:00. Tablet clock is 5 hours ahead but still 4 Nov (15:00): date
     4 Nov 15:00.
- **Expected:**
  - Step 1: "The date cannot be in the future" *(400 validation)*. Nothing posted.
  - Step 2: "The saved-on time cannot be in the future" *(400 validation)*. Nothing posted.
  - Step 3: "The date cannot be in the future" *(400 validation)*. The operator re-enters
    after midnight and it is accepted.
  - Step 4: accepted, dated 4 Nov 15:00 (only the **day** is checked).
- **Note:** in step 4 the movement carries a time later than the server's now. A later
  movement on the same roll recorded at 11:00 is then posted in ERPNext at 15:00:01 (after it),
  not at 11:00.

### TC-DATE-009 Inward (roll registration) follows the same date rule
- **Status:** 🆕 to build
- **Covers:** AC-01 · I-2
- **Layer:** Auto
- **Given:** server now 4 Nov 10:00.
- **Steps:**
  1. Operator registers R40b dated 5 Nov.
  2. Operator registers R40c dated 2 Nov (saved-on 4 Nov).
  3. Operator registers R40d dated 3 Nov (yesterday).
- **Expected:** step 1 "The date cannot be in the future"; step 2 "The date must be today or
  yesterday" (both *(400 validation)*, nothing posted); step 3 accepted, Received on 3 Nov.
  Same cases as TC-IN-015/016/017 in section 01; listed here so the date rules are complete.
- **Note:** today `rolls.register_roll` does **no** date check. Any past or future date is
  accepted and becomes the Received day in the reports.

### TC-DATE-010 A movement dated before the roll was received
- **Status:** 🔶 value to confirm (refusal wording)
- **Covers:** AC-01, T-4 · I-2, I-3, I-6
- **Layer:** Auto
- **Given:** server now 4 Nov 10:00. R45b, RT 501, registered **4 Nov 09:00**, 1000 kg, Godown A.
- **Steps:**
  1. Operator sells R45b to Direct Sale and picks **yesterday** (3 Nov).
  2. Variant: Operator issues R45b out to Running Godown dated 3 Nov.
- **Expected (doc: I-3 no negative stock on any date):** refused (proposed wording: "This roll
  was received on 4 Nov — a movement can't be dated before that") *(400 validation)*. Nothing
  posted.
- **Note:** today both are **accepted** (the date rule only looks at today/yesterday):
  - Step 1: report 3 Nov shows **Sold 1000, Closing −1000** (negative, I-3 broken). 4 Nov
    shows Open −1000, Recv 1000, Close 0. The daily roll report for 3 Nov lists R45b as Sold
    with Received date 4 Nov.
  - Step 2: the daily roll report for 3 Nov says R45b was Out, 1000 kg, in Running Godown on
    3 Nov. The consumption report for 3 Nov has no row for it.
  - ERPNext stays correct (it posts these just after the receipt, on 4 Nov), so ERPNext's stock
    as of 3 Nov and the reports for 3 Nov disagree.

### TC-DATE-011 Physical count (ADJUSTMENT) date
- **Status:** 🔶 value to confirm
- **Covers:** E-5 · I-2
- **Layer:** Auto
- **Given:** R43, in stock, 1000 kg, Godown A, received 1 Oct. Server now 4 Nov.
- **Steps:**
  1. Physical count on R43 to 990 kg, dated **10 Oct**, remarks "count".
- **Expected (proposed):** the same today-or-yesterday rule as other movements: "The date must
  be today or yesterday" *(400 validation)*.
- **Note:** today an ADJUSTMENT (and adding weight back, IN) is only checked against the
  future. Step 1 is accepted, and the 10 Oct report changes (Adj −10). Portal corrections are
  always dated "now", so this only matters for the API.

---

## Offline and sync

How sync works today (`sync.py`): the tablet sends its queue as one batch (at most 50 items).
Lots, vendors and paper codes run first, then rolls and movements **in the order queued**. Each
item has its own `client_id`. A resent item returns what it wrote the first time. Each item
commits on its own: a failure undoes that item only. Later items on the same roll come back
`skipped` (`dependency_failed`). Each call writes a **Sync Log** (applied / failed / skipped).

### TC-SYNC-001 Several movements queued offline sync in the order they were made
- **Status:** ✅ today
- **Covers:** T-5, AC-01, AC-03, AC-05 · I-1, I-2, I-6
- **Layer:** Auto
- **Given:** D1 = 4 Nov. R51 (RT 502) 800 kg Godown B and R52 (RT 502) 600 kg Godown A, both
  received 1 Nov. Tablet offline all morning.
- **Steps:** Operator, offline, in this order:
  1. 09:00 registers R50: RT 501, 1000 kg, Godown A, lot CH-100.
  2. 09:10 issues R50 out to Running Godown.
  3. 09:20 issues R51 out to Running Godown.
  4. 09:30 sells R52 to Direct Sale.
  5. 09:40 returns R50 at 700 kg.
  6. 09:50 returns R51 at 750 kg.
  7. 10:00 Tablet comes online and sends the 6 items in one batch.
- **Expected:**
  - Results: 6 × `ok`, in the order sent. Sync Log: applied 6, failed 0, skipped 0.
  - Roll Movement rows are written in queue order, each with its own saved-on time.
  - History R50: `Received 1000 kg` · `Issued out 1000 kg to Running Godown` ·
    `Returned 700 kg to Godown A · 300 kg used`. R51: `Issued out 800 kg to Running Godown` ·
    `Returned 750 kg to Godown B · 50 kg used`. R52: `Sold — 600 kg`.
  - Report 4 Nov (Base paper): Open 1400, Recv 1000, Cons 350, RtV 0, Sold 600, Adj 0,
    Close 1450, Floor 0. (1400 + 1000 − 350 − 600 = 1450 = R50 700 + R51 750.)
  - If the order were broken (step 5 sent before step 2) the return would be refused "This roll
    is not currently out, so it cannot be returned". That is why the order is kept.

### TC-SYNC-002 Manual: one operator works offline, then syncs
- **Status:** ✅ today
- **Covers:** T-5, AC-01, AC-03 · I-1, I-2, I-6
- **Layer:** Manual
- **Given:** today = D1. The tablet is logged in as the operator and has synced. R53 (RT 501,
  1000 kg, Godown A) exists. The tester watches the portal and does not touch the tablet.
- **Steps:**
  1. Operator turns on airplane mode on the tablet.
  2. Operator registers R54: RT 502, 500 kg, Godown A, with photos.
  3. Operator issues R53 out to Running Godown (weighs 1000 kg).
  4. Operator returns R53 at 800 kg.
  5. Tester refreshes the portal: R54 does not exist yet, R53 is still In stock.
  6. Operator turns airplane mode off and waits for the sync indicator to clear.
  7. Tester refreshes the portal and opens R53, R54 and Reports → Consumption → Daily (D1).
- **Expected:**
  - After step 6 the tablet shows no pending items.
  - R54: In stock · 500 · Godown A, photos open, history `Received 500 kg`.
  - R53: In stock · 800 · Godown A, history `Issued out 1000 kg to Running Godown` then
    `Returned 800 kg to Godown A · 200 kg used`, both dated D1.
  - Report D1 (Base paper): Recv 500, Cons 200, Close = Open + 300, Floor 0.
  - Daily roll report D1: "2 rolls moved".

### TC-SYNC-003 The same item sent twice is applied once
- **Status:** ✅ today
- **Covers:** E-1 · I-1, I-2
- **Layer:** Auto
- **Given:** R55, RT 501, 1000 kg in Godown A.
- **Steps:**
  1. Tablet sends OUT R55 → Running Godown, `client_id` X. The response is lost.
  2. Tablet resends the same item with `client_id` X.
  3. Variant (tablet bug): the same OUT is resent with a **new** `client_id`.
  4. Two copies of a RETURN of R55 at 900 kg with the same `client_id` Y arrive at the same
     moment (two connections).
  5. One batch contains two items with the same `client_id` Z.
- **Expected:**
  - Step 2: `ok`, with the same movement as step 1. One OUT row, one ERPNext transfer.
  - Step 3: refused: "This roll is already out — record its return first" *(409 conflict)*. The
    roll's state stops a double outward even without the `client_id`.
  - Step 4: both answers `ok` with the same movement. One return row. Cons 100 counted once.
  - Step 5: the whole batch is refused: "Every item needs its own client_id". Nothing is written.
  - Throughout: `ledger_mismatches()` empty; R55 history has exactly one row per real action.

### TC-SYNC-004 Two tablets, one roll, same minute
- **Status:** ✅ today
- **Covers:** E-2 · I-1
- **Layer:** Auto
- **Given:** R56, RT 502, 1000 kg in Godown A. R57, RT 502, 800 kg, out on Running Godown.
- **Steps:**
  1. 10:00:05 Tablet A issues R56 out; 10:00:07 tablet B issues R56 out (different client_ids).
  2. Reset. Tablet A sells R56; tablet B sells R56 a second later.
  3. Reset. Tablet A sells R56; tablet B issues R56 out a second later.
  4. Reset. Tablet A issues R56 out; tablet B sells R56 a second later.
  5. Tablet A returns R57 at 600 kg; tablet B returns R57 at 650 kg a second later.
- **Expected:** the first write wins. The second is refused, and nothing of it is posted:

  | Step | Second tablet gets |
  |---|---|
  | 1 | "This roll is already out — record its return first" *(409 conflict)* |
  | 2 | "This roll has already been sold" *(409 conflict)* |
  | 3 | "This roll has already been sold" *(409 conflict)* |
  | 4 | "This roll is out on production — receive it back before selling it" *(409 conflict)* |
  | 5 | "This roll is not currently out, so it cannot be returned" *(409 conflict)* |

  - One movement row and one ERPNext document per step. Step 5: R57 In stock · 600 (Cons 200).
  - The two requests queue on the roll (row lock). Neither fails with a server error.

### TC-SYNC-005 Late sync dated earlier than a movement already posted
- **Status:** 🔶 value to confirm (refuse, or accept and repost the ledger)
- **Covers:** T-4, T-6, E-2 · I-1, I-2, I-6
- **Layer:** Auto
- **Given:** R58, RT 501, 1000 kg, received D1 in Godown A. Today = D5.
- **Steps:**
  1. D5 08:00 Tablet B issues R58 out to Running Godown (dated D5 08:00).
  2. D5 08:30 On tablet A, the operator returns R58 at 700 kg and by mistake picks
     **yesterday (D4)**. Synced at once.
- **Expected (doc: "the ledger stays in date order"; T-6: a late entry that no longer fits is
  refused):** step 2 is refused because it is dated before the roll's latest movement
  (proposed wording: "This roll already has a movement on D5 08:00 — a later entry can't be
  dated before it") *(409 conflict)*. Nothing posted. R58 stays Out · 1000 · Running Godown.
- **Note:** today step 2 is **accepted** (the roll is out, and D4 is "yesterday"):
  - ERPNext does not post it on D4. `stock_docs.ledger_time` puts it 1 second after the roll's
    newest document (D5 08:00:01), so ERPNext's ledger is in **entry** order. The reports use
    the movement's own date (D4).
  - Reports: D4 Cons 300, Close 700, Floor 0. That is a return on D4 of a roll that only went
    out on D5. D5: Open 700, Close 700, Floor 0.
  - Daily roll report D5 says R58 is **Out, 1000 kg, Running Godown**, while the roll is In
    stock · 700 · Godown A (I-6 broken). ERPNext as of end of D4 says 1000 in Godown A; the
    report says 700 (I-1 "as of the day" broken).
  - When the late entry no longer fits the roll's state (TC-TL-006) it is refused today.

### TC-SYNC-006 A batch where one item fails: the others still post
- **Status:** ✅ today
- **Covers:** E-1, E-2 · I-1, I-2
- **Layer:** Auto
- **Given:** R70 (1000 kg, Godown A, in stock), R71 (800 kg, Godown A, in stock), R72 (600 kg,
  Godown B, in stock), all RT 502.
- **Steps:** Tablet sends one batch, in this order:
  1. OUT R70 → Running Godown.
  2. RETURN R71 at 700 kg (R71 is not out).
  3. OUT R71 → Running Godown.
  4. SELL R72 to Direct Sale.
  5. Register R73 with weight 0.
  6. OUT R73 → Running Godown (`roll_client_id` = item 5).
- **Expected:**

  | Item | Status | Detail |
  |---|---|---|
  | 1 | ok | R70 Out |
  | 2 | failed | "This roll is not currently out, so it cannot be returned" *(409 conflict)* |
  | 3 | skipped | `dependency_failed` (later movement on the roll whose movement failed) |
  | 4 | ok | R72 Sold |
  | 5 | failed | "Weight must be greater than 0" *(400 validation)* |
  | 6 | skipped | `dependency_failed` (its roll failed) |

  - Sync Log: applied 2, failed 2, skipped 2. Items 1 and 4 are visible to other tablets
    before the batch ends.
  - Report: Sold 600, Floor 1000; no trace of items 2, 3, 5, 6.
  - The tablet keeps 3 and 6 queued. When it resends after the operator fixes item 2, item 1
    comes back as the same `ok` (no second OUT).
- **Note:** item 3 would have succeeded on its own. It is skipped on purpose because queue
  order decides the roll's weight. Reviewers should know a single bad entry holds back that
  roll's later entries.

### TC-SYNC-007 A half-applied batch is retried: nothing doubles
- **Status:** ✅ today
- **Covers:** E-1, T-5 · I-1, I-2
- **Layer:** Auto
- **Given:** a batch of 8 movements on 8 different in-stock rolls (OUT each to Running Godown).
- **Steps:**
  1. Tablet sends the batch. The server applies items 1–5, then the connection drops.
  2. Tablet resends the same 8 items with the same client_ids.
- **Expected:** step 2 returns 8 × `ok`. Items 1–5 are the movements written in step 1
  (same names). 6–8 are new. Exactly 8 OUT rows and 8 ERPNext transfers. Report Floor = sum of
  the 8 rolls' kg. Two Sync Log entries.

### TC-SYNC-008 The tablet's delta pull picks up portal corrections, deletions and master changes
- **Status:** ✅ today
- **Covers:** E-3, E-4, E-6, AC-06 · I-6
- **Layer:** Auto
- **Given:** the tablet has pulled everything and saved a checkpoint per kind (materials,
  vendors, locations, remarks, buyers, lots, rolls, movements). R74 (unmoved, 1000 kg),
  R75 (moved, In stock 600 kg), R76 (In stock, Godown A), R77 (with history), all RT 501.
- **Steps:**
  1. Supervisor corrects R74's weight 1000 → 950 on the portal.
  2. Supervisor corrects R75's current kg 600 → 580.
  3. Supervisor moves R76 from Godown A to Godown B (location edit).
  4. Supervisor deletes R77.
  5. Admin disables location "Godown B rack 3", adds remark code "WET", adds buyer
     "Kumar Traders".
  6. Tablet pulls each kind after its checkpoint, within 5 seconds of step 5, then again 10
     seconds later.
- **Expected:**
  - rolls: R74 arrival 950 / current 950; R75 current 580; R76 location Godown B; R77 with
    `deleted: true`.
  - movements: R74's **same** received row with weight 950 (corrected in place, no new row);
    a **new** row for R75 `Corrected by 20 kg`, remarks "Corrected on the portal"; **no** new
    row for R76; every R77 row with `deleted: true`.
  - locations: "Godown B rack 3" with `disabled: 1` (flagged, not removed). remarks: WET.
    buyers: Kumar Traders.
  - Changes from the last 5 seconds are held back on the first pull and arrive on the next.
    Nothing is skipped or repeated across a page boundary (rows sharing one modified time).
  - Movements pulled by an operator never carry `rate_per_roll`.

### TC-SYNC-009 Batch-level refusals
- **Status:** ✅ today
- **Covers:** E-1
- **Layer:** Auto
- **Given:** any state.
- **Steps:**
  1. Send an empty batch.
  2. Send 51 items.
  3. Send an item whose `client_id` is `abc`.
  4. Send an item with type `pallet`.
- **Expected:** the whole batch is refused and nothing is written: 1 "Nothing to sync";
  2 "A batch cannot exceed 50 items — send the rest in the next call"; 3 "client_id must be a
  UUID"; 4 "Unknown item type: pallet".

---

## Reports

### What each report and column means

**Consumption report** (Reports → Consumption). Period: **Daily** ("Date"), **Weekly**
("Any day in the week", Monday to Sunday) or **Monthly** ("Any day in the month", calendar
month). The date picker stops at today. Grouping: **By material** or **By design**. Figures in
kg. It counts every movement dated in the period, in IST days. Rows whose figures are all 0 are
left out. A deleted roll, and its movements, are never counted.

| Column (screen / CSV) | Meaning |
|---|---|
| Material code / Material | (By material) the material's code and name |
| RT code / Delta code / Vendor / Material | (By design) a design is the RT and Delta codes together; vendors and materials of its rolls are listed |
| Opening / Opening (kg) | kg on all live rolls (in godowns **and** out on the floor) at the start of the first day |
| Received / Received (kg) | new rolls, and weight added back to a roll |
| Consumed / Consumed (kg) | weight used: out weight − returned weight, counted **on the return day**; a roll returned at 0 or marked consumed counts all it held |
| Returned to vendor / Returned to vendor (kg) | kg sent back to the vendor |
| Sold / Sold (kg) | kg sold |
| Adjusted / Adjusted (kg) | signed change from a physical count or a portal correction of a moved roll's kg |
| Closing / Closing (kg) | Opening + Received − Consumed − Returned to vendor − Sold + Adjusted; includes what is out on the floor |
| Out on floor / Out on floor at close (kg) | the part of Closing on rolls that are out at the end of the period |

Downloads: **Summary CSV** (the table, with a Total line) and **Roll detail CSV** (one line per
movement that used weight: the proof behind Consumed). Columns of the detail CSV: Date · Roll
number · Barcode · Material code · Material · RT code · Delta code · Consumed (kg) · Left on
roll (kg) · Lot type · Challan / invoice no · Used at · Issued to · Note.

**Daily roll status report** (Reports → Daily roll status): one row per roll that moved on the
day, as it stood after its last movement that day. The screen shows only "N rolls moved" and a
**Download CSV** button. Columns, in order:

| Column | Meaning |
|---|---|
| Report date | the day asked for |
| Roll number · Barcode | the roll |
| Lot type · Challan / invoice no | the lot it came in on ("Challan" or "Invoice") |
| Vendor code · Vendor | the roll's vendor |
| Paper code · RT code · Delta code | the roll's paper / design |
| Material code · Material · GSM · Width (mm) | the roll's material and size |
| Received date | the day of its first received row |
| Unit | always kg |
| Weight on arrival | kg registered |
| Final weight | kg on the roll after its last movement that day |
| Final status | In stock · Out · Consumed · Returned to vendor · Sold, after that movement |
| Last movement | Received · Outward · Inward · Adjusted · Consumed · Returned to vendor · Sold |
| Weight moved | kg the last movement moved |
| Weight used | kg used (only for a return / consume) |
| Last location | where the roll was after that movement (blank when finished) |
| Issued to | as entered on the last movement |
| Remarks | remark labels picked on the roll and on the last movement |
| Movement note | free-text note on the last movement |
| Roll note | the roll's own note |
| Movements that day | how many movements the roll had that day |
| Last movement recorded at | when the server wrote the last movement (IST) |
| Recorded by | who recorded it |

**Report data set RPT-SET** (used by several cases). D0 is a Monday.
- D0: R60 1000 kg RT 501 Godown A · R61 800 kg RT 502 Godown A · R62 500 kg RT 501 Godown B ·
  R64 400 kg RT 501 Godown A, all lot CH-100, all received D0.
- D1 (in this order): 09:00 R63 received 700 kg RT 502 Godown A · 10:00 R60 out to Running
  Godown, issued to "Machine 2" · 10:30 R64 out to Running Godown · 11:00 R62 returned to vendor
  · 12:00 R61 sold to Direct Sale, bill SB-101, vehicle GJ05AB1234 · 15:00 R63 physical count
  690 kg, remarks "Physical count" · 17:00 R60 returned at 600 kg, note "edge torn", remark
  MISPRINT.
- D2–D6: no movements.
- End of D1: R60 In stock 600 Godown A · R61 Sold 0 · R62 Returned to vendor 0 · R63 In stock
  690 Godown A · R64 Out 400 Running Godown.

### TC-RPT-001 Opening and Closing chain from day to day
- **Status:** ✅ today
- **Covers:** AC-03 · I-2
- **Layer:** Auto
- **Given:** RPT-SET.
- **Steps:**
  1. Read daily reports D0, D1, D2 by material.
- **Expected:**

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | D0 | 0 | 2700 | 0 | 0 | 0 | 0 | 2700 | 0 |
  | D1 | 2700 | 700 | 400 | 500 | 800 | −10 | 1690 | 400 |
  | D2 | 1690 | 0 | 0 | 0 | 0 | 0 | 1690 | 400 |

  - Each day's Open = the day before's Close. D1 Close 1690 = R60 600 + R63 690 + R64 400
    (R64 is out, but still counts in Closing).

### TC-RPT-002 Received
- **Status:** ✅ today
- **Covers:** AC-01 · I-2
- **Layer:** Auto
- **Given:** RPT-SET (after D1, R60 holds 600 of its 1000 kg arrival, In stock, Godown A).
- **Steps:**
  1. Read D1: Recv.
  2. D2 Supervisor adds 50 kg back to R60 (IN, 600 → 650).
  3. D2 Supervisor tries to add 400 kg back to R60 (650 + 400 > 1000).
- **Expected:** D1 Recv 700 (R63 only; RPT-SET's D0 rolls are D0's Received). D2 Recv 50,
  Close 1740. Step 3 refused: "This roll only ever held 1000 kg — cannot add more than that"
  *(400 validation)*.
- **Note:** opening-stock rolls loaded at go-live must show as Opening, not Received (OS-3, 🆕,
  section 04).

### TC-RPT-003 Consumed
- **Status:** 🔶 value to confirm (counted on the return day, per AC-03)
- **Covers:** AC-03, AC-07a · I-2, I-4
- **Layer:** Auto
- **Given:** RPT-SET. Plus R65 (RT 501, 500 kg, out since D0) and R66 (RT 501, 300 kg, in stock
  in Godown B).
- **Steps:**
  1. D1 17:00 R60 returned at 600 (RPT-SET).
  2. D1 R65 returned at **0 kg** (all used).
  3. D1 R66 marked consumed (CONSUME, no outward).
  4. D1 R66 marked consumed again.
- **Expected:**
  - D1 Cons = 400 (R60) + 500 (R65) + 300 (R66) = 1200.
  - R65 and R66: status Consumed, 0 kg, no godown. History R65 `Returned 0 kg · 500 kg used`;
    R66 `Consumed — 300 kg used up`.
  - Step 4: accepted, but a no-op: the history row reads `Consumed`, weight 0. Cons stays 1200.
  - R64 (out since D1, not back) adds **nothing** to Consumed until it returns.

### TC-RPT-004 Returned to vendor
- **Status:** ✅ today (whole roll); 🆕 to build (part of a roll, AC-07b)
- **Covers:** AC-04, AC-07b · I-2, I-4
- **Layer:** Auto
- **Given:** RPT-SET. Plus R5 (RT 501, 1000 kg, Godown A, received D0).
- **Steps:**
  1. D1 11:00 R62 returned to vendor (RPT-SET).
  2. D1 R5: return 300 kg to vendor (partial).
- **Expected:** D1 RtV = 500 (R62) + 300 (R5) = 800. R62 Returned to vendor · 0. R5 In stock
  700. ERPNext Purchase Returns 500 and 300.
- **Note:** today step 2 returns the whole roll (1000), so RtV = 1500. See section 02 for the
  partial return cases.

### TC-RPT-005 Sold
- **Status:** ✅ today (whole roll); 🆕 to build (part of a roll, AC-08b)
- **Covers:** AC-05, AC-08b · I-2, I-4
- **Layer:** Auto
- **Given:** RPT-SET. Plus R6 (RT 502, 1000 kg, Godown A, received D0).
- **Steps:**
  1. D1 12:00 R61 sold (RPT-SET).
  2. D1 R6: sell 250 kg to Direct Sale (partial).
- **Expected:** D1 Sold = 800 + 250 = 1050. R6 In stock 750.
- **Note:** today step 2 sells all 1000, so Sold = 1800.

### TC-RPT-006 Adjusted
- **Status:** ✅ today
- **Covers:** E-3, E-4, E-5 · I-2, I-4
- **Layer:** Auto
- **Given:** R67 (RT 502, 1000 kg, received D1, Godown A, out D2, returned D3 at 700).
  R68 (RT 502, 300 kg, Godown A, received D1). R69 (RT 502, 1000 kg, Godown A, received D1,
  never moved).
- **Steps:**
  1. D4 Operator physical count on R67 = 690 (remarks "count").
  2. D5 Physical count on R67 = 700.
  3. D6 Supervisor corrects R67's current kg 700 → 650 on the portal.
  4. D6 Physical count on R68 = 0.
  5. D6 Supervisor corrects R69's weight 1000 → 950 on the portal (unmoved roll).
- **Expected:** every day read after step 5:

  | Day | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|
  | D1 | 0 | **2250** | 0 | 0 | 0 | 0 | 2250 | 0 |
  | D2 | 2250 | 0 | 0 | 0 | 0 | 0 | 2250 | 1000 |
  | D3 | 2250 | 0 | 300 | 0 | 0 | 0 | 1950 | 0 |
  | D4 | 1950 | 0 | 0 | 0 | 0 | −10 | 1940 | 0 |
  | D5 | 1940 | 0 | 0 | 0 | 0 | +10 | 1950 | 0 |
  | D6 | 1950 | 0 | 0 | 0 | 0 | −350 | 1600 | 0 |

  - D6 Adj −350 = R67 −50 (`Corrected by 50 kg`, "Corrected on the portal") + R68 −300.
  - R68 ends **Consumed · 0 · no godown**, but its 300 kg shows as **Adjusted**, not Consumed.
  - R69's correction adds no history row and no Adjusted figure. It **rewrites D1**: Received
    was 2300 before step 5, 2250 after.
  - D6 Close 1600 = R67 650 + R69 950.
- **Note:** a physical count to 0 finishes the roll as "Consumed" but reports the kg under
  Adjusted. 🔶 Team to confirm. A reviewer may expect it under Consumed (or a separate
  "written off").

### TC-RPT-007 Out on floor at close
- **Status:** ✅ today
- **Covers:** AC-03 · I-2
- **Layer:** Auto
- **Given:** RPT-SET.
- **Steps:**
  1. Read D1 and D2 (daily), and the week D0–D6.
  2. D7 R64 returned at 350.
- **Expected:** D1 Floor 400 (R64 only; R60 went out and came back the same day, so it
  doesn't count). D2–D6 Floor 400. Week D0–D6 Floor 400. D7 Floor 0, Cons 50. Floor is never
  more than Close.

### TC-RPT-008 Consumption by material, every column in one day
- **Status:** ✅ today
- **Covers:** AC-03, AC-04, AC-05, E-5 · I-2
- **Layer:** Both
- **Given:** RPT-SET.
- **Steps:**
  1. Supervisor opens Reports → Consumption, Daily, By material, date D1.
- **Expected:**

  | Material | Opening | Received | Consumed | Returned to vendor | Sold | Adjusted | Closing | Out on floor |
  |---|---|---|---|---|---|---|---|---|
  | Base paper | 2700 | 700 | 400 | 500 | 800 | −10 | 1690 | 400 |
  | Total | 2700 | 700 | 400 | 500 | 800 | −10 | 1690 | 400 |

  2700 + 700 − 400 − 500 − 800 − 10 = 1690. The Consumed column is in bold.

### TC-RPT-009 Consumption by design equals the sum of its rolls
- **Status:** ✅ today
- **Covers:** T-3 · I-2
- **Layer:** Both
- **Given:** RPT-SET.
- **Steps:**
  1. Supervisor opens Reports → Consumption, Daily, **By design**, date D1.
  2. Types `502` in "Search by RT or Delta code".
  3. Types `730` instead.
  4. Types `999` instead.
- **Expected:**

  | RT code | Delta code | Vendor | Material | Open | Recv | Cons | RtV | Sold | Adj | Close | Floor |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | RT 501 | 730N | ARIHANT | Base paper | 1900 | 0 | 400 | 500 | 0 | 0 | 1000 | 400 |
  | RT 502 | — | ARIHANT | Base paper | 800 | 700 | 0 | 0 | 800 | −10 | 690 | 0 |
  | Total | | | | 2700 | 700 | 400 | 500 | 800 | −10 | 1690 | 400 |

  - RT 501 = R60 (1000 → 600, Cons 400) + R62 (500, RtV 500) + R64 (400, out). RT 502 = R61
    (800, Sold) + R63 (Recv 700, Adj −10).
  - Rows are sorted by Consumed, highest first, then by RT code.
  - Design totals = material totals (TC-RPT-008).
  - Step 2 shows RT 502 only; step 3 RT 501 only. A searched list hides the Total line. Step 4:
    "No design matches this search."

### TC-RPT-010 Daily, weekly and monthly: weekly and monthly are the sum of their days
- **Status:** ✅ today
- **Covers:** I-5
- **Layer:** Auto
- **Given:** RPT-SET (D0 = Monday) and every timeline in this section.
- **Steps:**
  1. For every week and month touched by the data, read the period and each of its days.
- **Expected:**
  - Received, Consumed, Returned to vendor, Sold and Adjusted of the period = the sum of its
    days. Opening = the first day's Opening. Closing and Out on floor = the last day's.
  - RPT-SET week D0–D6: Open 0, Recv 3400, Cons 400, RtV 500, Sold 800, Adj −10, Close 1690,
    Floor 400. (3400 − 400 − 500 − 800 − 10 = 1690.)
  - The page shows the range: Weekly from Monday to Sunday (picking Wed 4 Nov 2026 shows
    "2026-11-02 to 2026-11-08"; picking Sun 1 Nov shows "2026-10-26 to 2026-11-01"). Monthly
    from the 1st to the last day (picking 15 Feb 2028 shows "2028-02-01 to 2028-02-29").

### TC-RPT-011 The balance equation holds for every day, every material and design
- **Status:** ✅ today
- **Covers:** I-2, I-3, I-5
- **Layer:** Auto
- **Given:** the golden dataset and every TC-TL timeline, replayed on the controlled clock.
- **Steps:**
  1. Harness: for every day from the first movement to 7 days after the last, read the daily
     report by material and by design.
- **Expected:** for every row and the Total line:
  - Opening + Received − Consumed − Returned to vendor − Sold + Adjusted = Closing (to 0.001 kg).
  - Opening = the day before's Closing.
  - Closing ≥ 0 and 0 ≤ Out on floor ≤ Closing (I-3).
  - Total = the sum of the rows. Design totals = material totals.
  - Closing per design = the sum of the live rolls' kg of that design at end of day (from the
    daily roll state), and = ERPNext's batch balances as of that day.
- **Note:** fails today on the data of TC-DATE-010 and TC-SYNC-005 (accepted out-of-order
  dates). The equation still holds there, but I-3 and the ERPNext comparison fail.

### TC-RPT-012 Summary CSV
- **Status:** ✅ today
- **Covers:** I-6
- **Layer:** Both
- **Given:** RPT-SET, D1.
- **Steps:**
  1. Supervisor clicks **Summary CSV** on Daily / By material / D1.
  2. Same on By design.
- **Expected:**
  - File names: `consumption-summary-<D1>-to-<D1>.csv`, `consumption-by-design-<D1>-to-<D1>.csv`.
  - By material (header, then rows, then Total):
    ```
    Material code,Material,Opening (kg),Received (kg),Consumed (kg),Returned to vendor (kg),Sold (kg),Adjusted (kg),Closing (kg),Out on floor at close (kg)
    BASE-PAPER,Base paper,2700,700,400,500,800,-10,1690,400
    ,Total,2700,700,400,500,800,-10,1690,400
    ```
  - By design:
    ```
    RT code,Delta code,Vendor,Material,Opening (kg),Received (kg),Consumed (kg),Returned to vendor (kg),Sold (kg),Adjusted (kg),Closing (kg),Out on floor at close (kg)
    RT 501,730N,ARIHANT,Base paper,1900,0,400,500,0,0,1000,400
    RT 502,,ARIHANT,Base paper,800,700,0,0,800,-10,690,0
    Total,,,,2700,700,400,500,800,-10,1690,400
    ```
  - Same figures as the screen. The button is disabled when the screen has no rows.

### TC-RPT-013 Roll detail CSV: the proof behind Consumed
- **Status:** ✅ today
- **Covers:** AC-02, AC-03 · I-6
- **Layer:** Both
- **Given:** RPT-SET plus R65 (TC-RPT-003, returned at 0 on D1).
- **Steps:**
  1. Supervisor clicks **Roll detail CSV** for D1.
  2. Supervisor picks D2 (no consumption).
- **Expected:**
  - File `consumption-detail-<D1>-to-<D1>.csv`, columns in order: Date, Roll number, Barcode,
    Material code, Material, RT code, Delta code, Consumed (kg), Left on roll (kg), Lot type,
    Challan / invoice no, Used at, Issued to, Note.
  - Lines (sorted by date, then roll number):
    - R60: Date D1, BASE-PAPER, Base paper, RT 501, 730N, Consumed 400, Left on roll 600,
      Challan, CH-100, Used at Running Godown, Issued to Machine 2, Note "edge torn".
    - R65: Consumed 500, Left on roll 0.
  - The sum of Consumed (kg) = the summary's Consumed for D1 by material.
  - Sales, vendor returns, adjustments and outwards have no line.
  - Step 2: the button is disabled (Consumed total is 0).

### TC-RPT-014 Daily roll status report and its CSV
- **Status:** ✅ today
- **Covers:** AC-02, I-6
- **Layer:** Both
- **Given:** RPT-SET. Roll R60 has remark MISPRINT ("Misprint") picked on the roll.
- **Steps:**
  1. Supervisor opens Reports → Daily roll status, date D1.
  2. Clicks **Download CSV**.
- **Expected:**
  - Screen: "5 rolls moved". File `daily-roll-report-<D1>.csv`, 30 columns in the order listed
    above, rows sorted R60, R61, R62, R63, R64.
  - R60 row: Report date D1 · Roll number R60 · Lot type Challan · Challan / invoice no CH-100 ·
    Vendor ARIHANT · RT code RT 501 · Delta code 730N · Material code BASE-PAPER · Material Base
    paper · Received date D0 · Unit kg · Weight on arrival 1000 · Final weight 600 · Final status
    In stock · Last movement Inward · Weight moved 600 · Weight used 400 · Last location Godown A
    · Remarks Misprint · Movement note edge torn · Movements that day 2 · Last movement
    recorded at D1 17:00 · Recorded by the operator's full name.
  - Other rows:

    | Roll | Last movement | Final status | Final weight | Weight moved | Weight used | Last location | Movements that day |
    |---|---|---|---|---|---|---|---|
    | R61 | Sold | Sold | 0 | 800 | | | 1 |
    | R62 | Returned to vendor | Returned to vendor | 0 | 500 | | | 1 |
    | R63 | Adjusted | In stock | 690 | 10 | | Godown A | 2 |
    | R64 | Outward | Out | 400 | 400 | | Running Godown | 1 |

  - R63's Movement note is "Physical count". Its Received date is D1.
- **Note:** **Roll note** is always blank today: the ERPNext report does not read a roll note
  (`reports.load` sets it to none). 🔶 Team to say if the column should be dropped or filled.

### TC-RPT-015 An empty day (stock, no movements)
- **Status:** ✅ today
- **Covers:** I-2, I-5
- **Layer:** Both
- **Given:** RPT-SET.
- **Steps:**
  1. Supervisor opens Consumption, Daily, D2.
  2. Supervisor opens Daily roll status, D2.
- **Expected:**
  - Consumption D2: Base paper Open 1690, all movement columns 0, Close 1690, Floor 400.
    Summary CSV enabled. Roll detail CSV disabled.
  - Daily roll status D2: "No rolls moved on that date". Download CSV is disabled. Through the
    API the CSV holds the header line only.

### TC-RPT-016 A date range with no stock and no movements
- **Status:** ✅ today
- **Covers:** I-2
- **Layer:** Both
- **Given:** RPT-SET. The period is the month before D0 (nothing existed yet). Also material
  Tissue, which has never had a roll.
- **Steps:**
  1. Supervisor opens Consumption, Monthly, a day in the month before D0.
  2. API: the same period's summary CSV.
- **Expected:**
  - Screen: "No stock or movements in this period." Summary CSV and Roll detail CSV disabled.
  - API answer: `rows: []`, every total 0. The CSV has the header and a Total line of zeros
    (`,Total,0,0,0,0,0,0,0,0`).
  - Tissue never appears as a row in any period.
  - A material or design whose rolls all finished before the period shows no row either.

### TC-RPT-017 A deleted roll disappears from past reports
- **Status:** ✅ today
- **Covers:** E-6 · I-1, I-2, I-6
- **Layer:** Auto
- **Given:** R65d, RT 501, received D1 500 kg Godown A, out D2, returned D3 at 300 kg.
  RPT-SET's R60 also exists (RT 501, 1000 kg received D1 for this case).
- **Steps:**
  1. Harness reads D1–D3 reports, daily roll reports and detail CSV.
  2. D5 Supervisor deletes R65d.
  3. Harness reads D1–D5 again.
- **Expected:**

  | Day | Before delete: Recv / Cons / Close | After delete: Recv / Cons / Close |
  |---|---|---|
  | D1 | 1500 / 0 / 1500 | 1000 / 0 / 1000 |
  | D2 | 0 / 0 / 1500 (Floor 500) | 0 / 0 / 1000 (Floor 0) |
  | D3 | 0 / 200 / 1300 | 0 / 0 / 1000 |

  - Daily roll reports D1–D3 no longer list R65d. The D3 detail CSV has no line. Daily roll
    status D2 and D3: "No rolls moved on that date".
  - ERPNext: all of R65d's documents cancelled, newest first; batch balance 0;
    `ledger_mismatches()` empty.
  - Same as TC-DEL-002 (section 04), checked here across every report.
- **Note:** deletion **rewrites the past**: a report printed or signed for D1–D3 no longer
  matches. 🔶 Team to accept, or to keep deleted rolls in closed periods.

### TC-RPT-018 Report period boundaries and refusals
- **Status:** ✅ today
- **Covers:** E-7 · I-2, I-5
- **Layer:** Auto
- **Given:** TC-DATE-007's data (movements at 3 Nov 23:59 and 4 Nov 00:01 IST); TC-TL-002's
  data (31 Oct / 1 Nov).
- **Steps:**
  1. Read 3 Nov and 4 Nov. Read October and November.
  2. API `consumption` with from = 2026-11-05, to = 2026-11-04.
  3. from = `2026-02-30`, to = 2026-03-01.
  4. No from, no to.
  5. from = to = 2026-11-04, group = `roll`.
  6. Daily roll report with no date, then with date = `04-11-2026`.
- **Expected:**
  - Step 1: each movement in its own day only. Movements on 31 Oct in October only, on 1 Nov
    in November only. A one-day range (from = to) is one day.
  - Step 2: "From must not be after to".
  - Step 3: "From must be YYYY-MM-DD".
  - Step 4: "From date is required, To date is required".
  - Step 5: "group: Invalid enum value. Expected 'material' | 'design', received 'roll'".
  - Step 6: "Date is required", then "Date must be YYYY-MM-DD".
  - All are *(400 validation)*. At most three messages are listed, then "(and N more)".

### TC-RPT-019 CSVs open correctly in Excel
- **Status:** ✅ today
- **Covers:** AC-02 · I-6
- **Layer:** Both
- **Given:** RPT-SET, with these changes: vendor ARIHANT's name is `અરિહંત પેપર`; R60's return
  note is `edge torn, "bad" side`; R63's count remark is `=1+2`; roll R60 goes out and back twice more
  on D1, using 0.1 kg and then 0.2 kg.
- **Steps:**
  1. Download all four CSVs for D1 (summary by material, summary by design, roll detail,
     daily roll status).
  2. Tester opens each in Excel (double-click, no import wizard).
- **Expected:**
  - Each file starts with the UTF-8 byte-order mark (bytes EF BB BF), and every line ends with
    CR LF.
  - Gujarati text shows correctly, not garbled.
  - `edge torn, "bad" side` stays in one cell, quotes intact.
  - `=1+2` shows as text `'=1+2`, not 3 (formula guard).
  - Numbers are plain numbers: `1000`, not `1000.0`; Consumed for those two returns adds to `0.3`, not `0.30000000000000004`; negatives like
    `-10` are numbers.
  - Column order exactly as in TC-RPT-012/013/014.

### TC-RPT-020 History, daily roll report and CSVs tell the same story
- **Status:** ✅ today
- **Covers:** I-6
- **Layer:** Auto
- **Given:** every TC-TL timeline.
- **Steps:**
  1. For each day with a movement, compare the roll's last history row that day, the daily
     roll report row, the detail CSV line (if any) and the summary figures.
- **Expected:** for each roll and day: daily roll report Final weight = the history row's kg
  after; Final status and Last location = the roll's state after that row; Weight used = the
  detail CSV's Consumed (kg) = what the history row says was used. The sum over rolls = the
  summary's Consumed. Example TC-TL-001 D20: history `Returned 400 kg to Godown A · 600 kg
  used`; daily roll report Final weight 400, Weight used 600, Godown A; detail CSV Consumed
  600, Left on roll 400; summary Consumed 600.
- **Note:** fails today in TC-SYNC-005 and TC-DATE-010 (accepted out-of-order dates).

### TC-RPT-021 Store loss column in the consumption report
- **Status:** 🆕 to build
- **Covers:** AC-09 · I-2
- **Layer:** Auto
- **Given:** R7, RT 501, 100 kg received D1 in Godown A (golden dataset).
- **Steps:**
  1. D5 Operator issues R7 out; the scale shows 80 kg.
- **Expected:** a **Store loss** column (screen "Store loss", CSV "Store loss (kg)",
  🔶 placed after Adjusted) shows 20 on D5 for Base paper and RT 501. D5: Open 100, Store loss
  20, Close 80, Floor 80. The equation becomes Open + Recv − Cons − RtV − Sold ± Adj −
  Store loss = Close, in every check of this section.
- **Note:** today there is no Store loss column, and the outward weight is only written into
  the note. Details in section 02.

---

## Open questions for the business

1. **Consumption on the return day** (TC-TL-009, TC-RPT-003): paper used in September but
   returned in October counts as October consumption. Accept, or ask the operator for the use
   date?
2. **A physical count to 0** (TC-RPT-006) finishes the roll as Consumed but reports the kg as
   Adjusted. Which column should it land in?
3. **Out-of-order dates** (TC-SYNC-005, TC-DATE-010): a movement dated before the roll's
   arrival or before its latest movement is accepted today. That gives negative closings on the
   earlier day and a daily roll report that contradicts the roll. Refuse (proposed), or accept
   and repost ERPNext in date order?
4. **Old offline queues and slow tablet clocks** (TC-DATE-006): accept any saved-on day
   (today), or refuse entries saved more than N days ago (proposed 7)?
5. **Physical count dates** (TC-DATE-011): today any past date. Apply today-or-yesterday?
6. **"Last movement recorded at"** (TC-TL-004/005): show when the server got it (today) or when
   the operator saved it on the tablet?
7. **Roll note column** (TC-RPT-014) is always blank. Drop or fill?
8. **Deleted rolls rewrite past reports** (TC-RPT-017). Acceptable for closed or signed periods?
9. **Financial-year view** (TC-TL-011): is an April–March report wanted on the portal? And who
   checks each March that ERPNext's next Fiscal Year exists?
10. **Store loss column placement** (TC-RPT-021): after Adjusted (proposed)?
