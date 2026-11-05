# Inventory acceptance criteria — Royale Touche on ERPNext

What the business must see before the ERPNext system replaces Node. Every case has steps and
the exact expected outcome, so a tester (or an automated test) can say pass or fail with no
judgement call.

Status: ✅ works today · 🆕 to build (decided 2026-11-04) · 🔶 proposal, team to confirm the value.

## How we test

1. **Timeline tests (automated, backend).** A controlled clock replays days of activity through
   the same API the tablet uses (sync), and after **every day** checks the roll, ERPNext's stock
   as of that date, and every report. Covers weeks in seconds; the tablet itself only allows
   today or yesterday.
2. **Golden dataset (business sign-off).** The rolls in "Golden dataset" below, replayed over
   ~4 weeks. The team fills the expected report numbers in a spreadsheet by hand; the system
   must match to the gram. The signed spreadsheet is the acceptance record.
3. **Manual pass (tablet + portal).** One operator, one day plus a "yesterday" entry, one
   offline-then-sync. The operator does every tap; the tester watches the screens.

### Checked after every step, in all three layers

- **I-1** ERPNext batch balance = roll's current kg, in the roll's godown (`ledger_mismatches` empty).
- **I-2** For every day and every material/design:
  opening + received − consumed − returned to vendor − sold ± adjusted − store loss = closing.
- **I-3** No negative stock anywhere, on any date.
- **I-4** A finished roll (consumed / sold / returned to vendor) holds 0 kg and has no godown.
- **I-5** Weekly and monthly report = sum of its days.
- **I-6** History rows, the daily roll report and the CSVs tell the same story as the roll.

## Shared setup

- Godowns: **Godown A**, **Godown B** (storage), **Running Godown** (production floor).
- Materials: Base paper. Vendor: ARIHANT with designs RT 501 / Delta 730N and RT 502.
- Users: operator (tablet only), supervisor, admin.
- Notation: D1, D2… are calendar days; times are IST.

---

## AC-01 Enter a roll (inward) ✅

**Steps:** on the tablet, register roll R1: barcode, roll no, lot (challan), vendor, design,
material, 1000 kg, Godown A, front/back photos. Sync.

**Expected**
- Roll: In stock, arrival 1000, current 1000, Godown A.
- History: 1 row "Received 1000 kg".
- ERPNext: one submitted Purchase Receipt, 1000 kg of R1's batch in Godown A.
- Reports (D1): Received 1000, Closing 1000 for Base paper and for RT 501.
- Portal: roll listed, photos open; lot shows the challan photo.

**Must be refused:** same barcode or roll no twice · weight 0 or negative · a future date ·
date older than yesterday.

## AC-02 Use the roll and record remarks ✅

**Steps:** R1 inward D1 → add remark code MISPRINT on the roll → D2 outward to Running Godown
with note "edge torn" → D2 return 700 kg with remark code COLOR-VAR.

**Expected**
- Remarks visible on the roll, on each history row, in the daily roll report and its CSV.
- Remarks never change kg: D2 consumed 300, closing 700.

## AC-03 Inward and outward on different dates ✅

**Steps:** D1 inward 1000 (Godown A) · D4 outward to Running Godown · D6 return 600.

**Expected**

| Day | Roll | Received | Consumed | Closing | Out on floor |
|---|---|---|---|---|---|
| D1 | In stock, 1000, Godown A | 1000 | 0 | 1000 | 0 |
| D2–D3 | unchanged | 0 | 0 | 1000 | 0 |
| D4 | Out, 1000, Running Godown | 0 | 0 | 1000 | 1000 |
| D5 | unchanged | 0 | 0 | 1000 | 1000 |
| D6 | In stock, 600, **back in Godown A** | 0 | **400** | 600 | 0 |

- Consumption is counted on the **return day** (D6), not the outward day. *(Same as Node —
  team to confirm.)*
- Weekly report covering D1–D7: received 1000, consumed 400, closing 600.

## AC-04 Return to vendor (whole roll) ✅

**Steps:** R2 inward 500 D1 → D3 return to vendor.

**Expected:** Returned to vendor, 0 kg, no godown · ERPNext Purchase Return for 500 ·
D3 "Returned to vendor" 500, closing 0.

**Must be refused:** while the roll is out on the floor · already consumed · already returned.

## AC-05 Sale to another client (whole roll) ✅

**Steps:** R3 inward 800 D1 → D5 sell to "Direct Sale" (no buyer picked) with Savio bill no and
vehicle no.

**Expected:** Sold, 0 kg · ERPNext Delivery Note for 800 to Direct Sale, bill no and vehicle no
kept · D5 "Sold" 800 · godown roles never see a price.

**Must be refused:** while the roll is out on the floor.

## AC-06 Move a roll between storage godowns ✅ (portal edit — decided)

**Steps:** R4 in stock in Godown A → portal, Rolls → Edit → Location: Godown B → Save.

**Expected**
- Roll stays **In stock**, same kg, now Godown B.
- ERPNext: stock transfer A → B; ledger kg in Godown B.
- History: **no new row** (agreed: a location correction, not a movement).
- Reports: no received/consumed change.

**Must be refused:** roll out on the floor ("record its return before changing its location") ·
finished roll.

## AC-07 Partial roll return

**7a. Return from the floor with part used** ✅ — see AC-03.

**7b. Return part of a roll to the vendor** 🆕

**Steps:** R5 inward 1000 D1 → D3 return **300 kg** to vendor.

**Expected**
- Roll stays **In stock** with 700 kg in its godown.
- History row "Returned 300 kg to vendor".
- ERPNext Purchase Return for 300.
- D3 "Returned to vendor" 300, closing 700.
- Returning the remaining 700 later finishes the roll (Returned to vendor, 0 kg).

**Must be refused:** kg above what is on the roll · 0 or negative · roll out on the floor.

## AC-08 Partial roll sale

**8a. Sell what is left of a used roll** ✅ — R1 after AC-03 (600 kg) → sell → Sold, 600 kg sold.

**8b. Sell part of a roll, keep the rest** 🆕

**Steps:** R6 inward 1000 D1 → D4 sell **250 kg** to Direct Sale.

**Expected**
- Roll stays **In stock** with 750 kg.
- History row "Sold 250 kg".
- ERPNext Delivery Note for 250.
- D4 "Sold" 250, closing 750.
- Selling the remaining 750 later finishes the roll (Sold, 0 kg).

**Must be refused:** kg above what is on the roll · 0 or negative · roll out on the floor.

## AC-09 Weight lost in the store → alert 🆕

The tablet already makes the operator weigh a roll at outward (scale reading or typed, with a
scale photo). Today that number is only written into the note.

**Steps:** R7 inward 100 kg D1 (Godown A) → D5 outward: scale shows **80 kg**.

**Expected**
- The roll goes out at **80 kg** (the weighed figure).
- History: a row "Store loss 20 kg" (before the outward row), then "Issued out 80 kg".
- ERPNext: 20 kg written off from Godown A on D5; ledger stays equal to the roll.
- Reports (D5): a **Store loss** figure of 20 for Base paper and RT 501
  (closing = opening − 20, invariant I-2).
- **Alert** on the portal alerts page: "R7 weighed 80 kg at outward — 20 kg less than the
  100 kg recorded (last weighed D1 in Godown A)", with the scale photo, the operator and the
  date. Supervisors and admins can mark it reviewed, with a comment.

**Tolerance** 🔶 differences of up to **1 kg or 1 %** (whichever is larger) are treated as scale
noise: no alert, no loss row. Team to confirm.

**Heavier at outward** 🔶 (e.g. scale shows 102 for a 100 kg roll): stock stays 100, an alert
"weighed 2 kg more than recorded" is raised for review. Team to confirm.

## AC-10 Minimum stock per design → alert 🆕

**Setup:** portal Paper Codes page gets a **Minimum stock (kg)** per design 🔶 (kg, not roll
count — team to confirm). RT 501 minimum = 1500 kg.

**Steps:** D1 inward R8 1000 + R9 1000 (RT 501, in store 2000) → D3 R8 outward → D4 R8 return
200 (in store 1200).

**Expected**
- 🔶 "In store" counts rolls In stock in a storage godown; rolls out on the floor do not count.
  So on D3 in store = 1000 → **alert** "RT 501 below minimum: 1000 kg in store, minimum 1500"
  on the alerts page.
- One open alert per design: it updates its figures as stock moves, and does not repeat.
- The alert **closes by itself** when in store ≥ minimum (e.g. a new inward of 600 on D6).
- Designs without a minimum never alert.

## Alerts page 🆕 (shared by AC-09 and AC-10)

- Portal page "Alerts" for supervisor, admin and super admin. A badge in the menu shows the open count.
- Columns: type (Store loss / Low stock), roll or design, figures, date, status.
- Filters: open / reviewed, type, date range.
- Low-stock alerts close themselves. Store-loss alerts stay open until someone marks them reviewed.

---

## Multi-day timelines (automated + golden dataset)

**T-1 Long gap.** D1 inward 1000 → D12 outward → D20 return 400 → D27 sell remaining 400.
Every day D1–D27 checked; D20 consumed 600; D27 sold 400, closing 0.

**T-2 Month end.** 30 Oct inward 900 → 2 Nov outward → 3 Nov return 500.
October report: received 900, closing 900 (still in stock at month end).
November report: opening 900, consumed 400, closing 500.

**T-3 Several rolls, one design, mixed events on the same day.** D1 inward R10, R11, R12
(RT 502) → D3 R10 outward + R11 sold 300 (partial) + R12 returned to vendor → D5 R10 return.
Design report each day equals the sum of its rolls.

**T-4 Backdated entry.** On D8 the operator records an outward dated D7 (yesterday).
D7 report changes, D8 report shows the roll out; the ledger stays in date order.

**T-5 Offline overnight.** Tablet offline D9 evening, records a return; syncs D10 morning.
Movement dated D9; D9 report includes it; nothing lost or doubled.

**T-6 Late sync, earlier date.** Tablet A records a return dated D10 and syncs after tablet B
already posted a sale of that roll dated D11 → refused (the roll was not out); nothing posted.

## Extra cases

- **E-1 Same scan twice** (network retry): one movement, never two.
- **E-2 Two tablets, one roll, same minute:** one wins, the other gets a clear refusal.
- **E-3 Portal correction of an untouched roll** (weight / material / godown): history stays one
  row, receipt re-posted, reports follow.
- **E-4 Portal correction of a moved roll's current kg:** an "Adjusted" history row and the
  Adjusted report column.
- **E-5 Physical count** (ADJUSTMENT) up and down; to 0 finishes the roll.
- **E-6 Delete a roll with history:** all its stock documents reversed; reports for past days
  no longer count it.
- **E-7 Report boundaries:** a movement at 23:59 IST and one at 00:01 IST land on their own days.
- **E-8 Roles:** an operator can't log in to the portal; godown roles never see prices; only
  supervisors and above see alerts.

## Opening stock at go-live 🆕

The godowns already hold 300–1,500 rolls that have never been in any system (prod MongoDB had
no rolls). They are loaded once, at go-live.

**Decided (2026-11-04)**
- **Method:** the team fills a stock-take spreadsheet; we bulk-load it; then operators scan
  every roll on the tablet to confirm it is physically there.
- **Weight:** the roll's weight **today** (weighed at stock-take) is both its arrival and its
  current weight. Original arrival weights are not entered.
- **Arrival date:** the day the roll is loaded.
- **Challan:** an "OLD RECORD" lot, so old stock is recognisable everywhere.
- **Known per roll:** vendor and design (RT / Delta code); which rolls are out on the floor.
- **Stock-take takes 2–3 days** while production runs, so loading goes godown by godown.

**Spreadsheet columns:** roll no · barcode (old label, or blank to print a new one) · vendor
code · RT code / Delta code · material · GSM · width · kg (weighed) · godown (or Running Godown
when out on the floor) · remark code (optional).

**Load rules**
- Every row is checked before anything is posted. Unknown vendor, design not in that vendor's
  paper list, unknown godown or material, duplicate roll no or barcode, kg ≤ 0 → listed in an
  error report; nothing is guessed.
- A rehearsal load runs on a copy server first. Loading the same sheet twice adds nothing.
- Rolls out on the floor load as **Out** (Running Godown) at their weighed kg, so their return
  works out consumption.
- Old rolls are flagged **opening stock**: on their load day the reports show them as
  **Opening**, not **Received** (otherwise go-live day shows a huge fake "Received").
- Old rolls keep a vendor and a purchase receipt, so return to vendor and sale work on them.
- Blank barcodes get new labels from the Barcode generator; new numbers can never clash with
  old labels.
- Godown by godown: once a godown is loaded, its rolls move only through the new system.
  Rolls in a godown not yet loaded must not move (or are counted before they do).
- Minimum stock per design is set **after** the load, so day one doesn't flood the alerts page.

**Acceptance**
- **OS-1** For every godown × design: roll count and kg equal the stock-take sheet.
- **OS-2** ERPNext ledger equals the rolls (`ledger_mismatches` empty); total kg per material
  matches Savio's stock at the cut-off (or the difference is explained).
- **OS-3** Load-day report: Opening = loaded kg, Received 0. Next day's opening = that closing.
- **OS-4** Every loaded roll scans on the tablet (scan-to-confirm pass); unscanned rolls are
  listed for a recount.
- **OS-5** One old roll each goes through: outward → return (consumption right) · return to
  vendor (whole and partial) · sale (whole and partial) · portal godown move · a floor roll's
  return. Reports stay right after each.
- **OS-6** The first outward of an old roll compares against its stock-take weight; no false
  store-loss alerts.
- **OS-7** A rejected row (e.g. unknown design) never half-loads: the roll is either fully in,
  or not at all and listed in the error report.
- **OS-8** Re-running the load with the same sheet adds nothing and changes nothing.

## Golden dataset (layer 2)

| Roll | Design | Story | Covers |
|---|---|---|---|
| R1 | RT 501 | in 1000 → out → return 600 → sell 600 | AC-03, AC-08a |
| R2 | RT 501 | in 500 → return to vendor | AC-04 |
| R3 | RT 502 | in 800 → sell | AC-05 |
| R4 | RT 502 | in 700 → portal move A→B | AC-06 |
| R5 | RT 501 | in 1000 → vendor 300 → vendor 700 | AC-07b |
| R6 | RT 502 | in 1000 → sell 250 → out → return 500 | AC-08b |
| R7 | RT 501 | in 100 → out weighed 80 | AC-09 |
| R8/R9 | RT 501 | low-stock crossing and recovery | AC-10 |
| R10–R12 | RT 502 | same-day mix | T-3 |
| R13 | RT 501 | month-end crossing | T-2 |

The team fills, per day and per design: opening, received, consumed, returned to vendor, sold,
adjusted, store loss, closing, out on floor. The system must match every cell.
