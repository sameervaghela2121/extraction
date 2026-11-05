# Acceptance decisions log

Answers from the business review of the [test cases](test-cases/README.md), in the order taken.
Each line says what was decided and which cases change.

## 1. Dates (2026-11-04)

- **D-01 Consumption day:** counted on the **return day** (as today and in Node). Paper out on
  28 Sep and back on 3 Oct is October consumption. Cases: TC-TL-009, TC-RPT-003 stay as written.
- **D-02 Out-of-order dates:** a movement dated before the roll's arrival or before its latest
  movement is **refused**; nothing is posted. Cases: TC-DATE-010, TC-SYNC-005, TC-RET-011
  become refusals (🆕 fix).
- **D-03 Old offline entries:** an entry saved on the tablet **more than 2 days** before it
  reaches the server is refused and shown to the operator to re-enter. Cases: TC-DATE-006
  (🆕 fix).
- **D-04 Backdating:** **today or yesterday** for every movement, registration and physical
  count; the opening-stock load is the only exception. Cases: TC-IN-015/016, TC-ADJ-007,
  TC-DATE-009/011 become refusals (🆕 fix).

## 2. Reports (2026-11-04)

- **D-05 Physical count shortfall:** follows the inventory standard — consumption is material
  issued to production and used; a count that finds less than the books is a stock-take
  variance. So a fully used roll is recorded as **Consumed** (return at 0 kg, or Consume). A
  count that finds **less** (including 0) goes to **Store loss** with an alert, exactly like the
  outward weighing case (AC-09). A count that finds **more** stays under **Adjusted**.
  Cases: TC-RPT-006, TC-ADJ-001..007 and TC-LOSS gain a "count shortfall" case (🆕).
- **D-06 "Last movement recorded at":** shows when the **operator saved it on the tablet**.
  Cases: TC-TL-004/005 (🆕 fix).
- **D-07 Roll note column:** **filled** with the roll's own note; the note entered at
  registration must therefore be kept (today it is dropped). Cases: TC-RPT-014, TC-IN-019
  (🆕 fix).
- **D-08 Deleting a roll and past reports:** deleting a roll with movements in a **closed
  (previous) month is refused**; within the current month it is allowed and the reports follow.
  Cases: TC-RPT-017, TC-DEL-001..005 (🆕 fix).
- **D-09 Longer periods:** no fixed financial-year button; reports get a **custom from–to date
  range** (covers a financial year or any period), with the same columns and CSVs.
  Cases: TC-TL-011, TC-RPT gain a custom-range case (🆕).
- **D-10 Year end:** both — the system **creates the next financial year automatically** (every
  March and at install), **and** raises an alert on the Alerts page ahead of time: "FY 2027-28
  created" when done, or "FY 2027-28 could not be created — movements on 1 April will fail" if
  it failed, so the team knows in advance. A test proves 1 April works. Cases: TC-TL-011,
  TC-ALERT gain year-end cases (🆕).
- **D-11 Store loss column:** after Adjusted — Opening · Received · Consumed · Returned to
  vendor · Sold · Adjusted · Store loss · Closing · Out on floor. Cases: TC-RPT-021.
- **D-12 History text:** a count reads "Counted 50 kg less" / "Counted 50 kg more"; an inward
  top-up on an existing roll reports under **Adjusted**, not Received. Cases: TC-ADJ-002,
  TC-STATE-002 (🆕 fix).

## 3. Partial return to vendor and partial sale (2026-11-04)

- **D-13 What is entered:** the operator weighs the **piece going out** (e.g. 250 kg); the roll
  keeps the rest (1000 − 250 = 750 kg). Cases: TC-PRTV, TC-PSELL.
- **D-14 Scale photo:** **required** for the piece, same as outward (scale reading or typed kg
  + photo kept on the movement). Cases: TC-PRTV, TC-PSELL gain a "no photo → refused" case.
- **D-15 Price:** prices stay **off** for now (Savio bills); when switched on, a partial sale is
  priced **per kg**. Cases: TC-PSELL price cases become "no price field" until prices go live.
- **D-16 Bill no / vehicle no:** **optional** on a partial sale, same as a whole sale.
- **D-17 Whole or part:** **two buttons** on the Sell and Return-to-vendor screens — "Whole
  roll" and "Part of roll"; only "Part of roll" asks for the piece's kg (and scale photo).
- **D-18 Return-to-vendor remark:** **optional** for both whole and partial returns (changes
  today's rule where the whole-roll return needs one). Cases: TC-RTV, TC-PRTV (🆕 fix).
- **D-19 Where:** partial sales and partial returns can be recorded on the **tablet and the
  portal**. On the portal a supervisor enters the kg; the scale photo is required on the tablet
  only. Cases: TC-PRTV, TC-PSELL gain portal cases (🆕).
- **D-20 Small leftover:** nothing special — whatever kg remains stays on the roll.

## 4. Store loss (2026-11-04)

- **D-21 Tolerance:** **10 kg** (fixed, any roll size). Differences up to 10 kg are scale noise:
  no loss, no alert. It must be a **setting an admin can change later** without a code change.
  Cases: TC-LOSS tolerance tables move to 10 kg; add "admin changes tolerance" (🆕).
- **D-22 Loss amount:** above tolerance, the **whole difference** is store loss (100 recorded,
  80 weighed → 20 kg loss, roll goes out at 80). Stock always equals what the scale shows.
- **D-23 Approval:** stock **drops immediately**; production is never blocked. The alert waits
  for a supervisor to review and comment.
- **D-24 Heavier reading:** above tolerance, stock **stays** at the recorded kg (a roll can't
  gain paper) and a "weighed heavier" alert is raised for review. Within tolerance: ignored.
- *My call (no question needed):* the loss is written off from the godown the roll was sitting
  in when weighed.
- **D-25 Scale reads 0:** **refused** ("A roll can't go out at 0 kg — check the scale"). A roll
  that is really gone is handled with a physical count, which books the store loss (D-05).
- **D-26 Undoing a wrong weight** (8 typed instead of 80): a supervisor uses the **portal
  Rolls-page weight correction**; it is booked under Adjusted and the alert is then marked
  reviewed with a comment. History keeps both rows.
- **D-27 Warning:** the tablet shows a **confirm screen** before booking a loss: "Recorded 100 kg,
  you weighed 80 kg — 20 kg will be booked as store loss. Re-weigh or confirm."
- **D-28 Alert date:** the **movement date** (the day the roll was weighed); the alert also shows
  when it reached the server.

## 5. Minimum stock (in progress, paused 2026-11-04)

- **D-29 Unit:** **kg** (e.g. RT 501 minimum 1500 kg).
- **D-30 What a design is:** papers are **grouped automatically**: papers sharing an RT code
  or a Delta code, or linked by a paper carrying both, are one design **across all vendors**
  (1,459 designs from 1,531 papers). A design's total available kg = rolls in storage of any of
  its papers. The 4 groups that join two RT spellings via one Delta code (e.g. `129A` and
  `129 / 1129` via Delta `398`) go on a review list for the team to confirm or split.
- **D-31 What counts:** rolls **In stock in a storage godown** only; rolls out on the floor
  don't count.
- **D-32 Who sets minimums:** **supervisor and above** (supervisor, admin, super admin).
- **D-33 Minimum set below current stock:** the low-stock alert opens **at once** when the
  minimum is saved.
- **D-34 Minimum of 0:** means **alert when the design is completely empty** (0 kg in storage).
  An **empty box** means the design is not watched.
- **D-35 Running low again:** each drop below the minimum is a **new alert** (e.g. 1 Nov closed,
  10 Nov open), so the page shows how often a design runs low.
- **D-36 Minimum lowered or removed while an alert is open:** the alert **closes by itself**,
  with a note "minimum changed to 1,000 kg by <user>".
- **D-37 When the check runs:** on **current stock only**; a backdated movement never creates
  an alert for a past day.

## 6. Alerts page (2026-11-05)
- **D-38 Marking reviewed:** comment **optional**.
- **D-39 Reopening:** a reviewed alert can be **reopened by admin and super admin**, with a
  comment; the alert's history shows every review and reopen.
- **D-40 Notes on low-stock alerts:** supervisors can **add notes** ("ordered 5 rolls, arriving
  Friday") without closing it; it still closes only when stock recovers.
- **D-41 Default view:** **open alerts, newest first**; filters show reviewed/closed and a date range.
- *My call:* the date filter uses the alert's date (the movement date, D-28). Who sees the page
  stays as in the acceptance doc (supervisor, admin, super admin) unless topic 12 changes admin access.

## 7. Godown move (2026-11-05)
- **D-42 How a portal godown move is recorded:** as a **new history line** on the day of the move
  ("5 Nov · Moved to another godown · Godown B"), with a real stock transfer A → B in ERPNext,
  for **every** roll (moved before or not). The roll's kg is only ever in one godown. Changes
  today's behaviour for unmoved rolls (no more re-posting the arrival) and for moved rolls (no
  more silent transfer without a history line). Note for the build: this is a new kind of
  history row, so the tablet's history screen and sync must learn it. Cases: TC-MOVE-001..006,
  TC-COR-003/005 (🆕).
- **D-43 Location edit to Running Godown:** **allowed** (as today). *My call:* for minimum stock
  (D-31), a roll located in Running Godown never counts as "in storage", whatever its status.

## 8. Opening stock (2026-11-05)

- **D-44 GSM and width:** **optional** on the roll for now (blank allowed on the stock-take
  sheet and on the roll). Future plan: GSM and width become fixed properties of the **paper
  code** (with its RT / Delta code), and selecting a paper code **prefills** them, the same way
  RT and Delta codes are filled today.
- **D-45 Roll found during the scan pass but not on the sheet:** the operator **registers it on
  the tablet** right there as old stock (lot "OLD RECORD", weighed then).
- **D-46 Roll scanned in a different godown than the sheet says:** **the scan wins**; the roll's
  godown is corrected to where it was scanned and listed on the scan report.
- **D-47 Same roll number or barcode twice in the sheet:** **both rows rejected** and listed on
  the error report; the team fixes the sheet and re-loads.
- **D-48 Re-loading a fixed sheet:** rolls already loaded are **never changed** by a re-load; any
  difference (kg, godown) is **reported** so a supervisor corrects it on the portal.
- **D-49 Loading over several days:** old stock loaded on day 2, 3… shows in its **own report
  column "Old stock loaded"**, so every day still adds up (Day 2: Opening 1,000 · Old stock
  loaded 800 · Closing 1,800). Report equation becomes: opening + old stock loaded + received −
  consumed − returned − sold ± adjusted − store loss = closing.
- **D-50 Old floor rolls coming back:** for rolls loaded as "Out" (no outward entry), the
  **return screen asks the operator which storage godown** it goes to.
- **D-51 Value of old rolls:** **zero value**, no price column (same as new rolls today).
- *My calls:* an old floor roll's history shows one line "Opening stock — out on floor"; the
  loader's error report uses the style "Row 5 · OS-105 · vendor ARIHANTT not found".
- **Action for the team:** share a sample stock-take sheet and photos of old labels (to fix the
  label prefix for new labels and prove new numbers never clash with old ones).

## 9. Roles and remaining bugs (2026-11-05)
- **D-52 Roles:** only three roles are used: **super admin** (the development team), **godown
  supervisor**, and **operator** (tablet only). The **admin role is not used**; anything
  decided as "admin and above" means **super admin**.
- **D-53 Deleting a roll with history:** **supervisor and super admin** only; never the operator
  (also closed on the server side, not just the screen). Still limited by D-08 (closed months).
- **D-54 Deactivating a godown while one of its rolls is out on the floor:** **allowed**; when
  that roll comes back the **operator picks** another storage godown (same screen as D-50).
- **D-55 Reopening a reviewed store-loss alert:** **supervisor and super admin** (replaces D-39's
  "admin and above").
- **D-56 Stock bugs — fix all:** refuse a count or inward on a sold / consumed / returned roll;
  refuse Consume on a finished roll; godown **required** at registration; movement remark codes
  must come from the Remarks list. Cases: TC-STATE-003/004, TC-CON-003, TC-IN-018, TC-RM-004 (🆕 fix).
- **D-57 Other bugs — fix all:** a code already used on another roll as barcode **or** roll
  number is refused (at registration, on edit and in the stock-take load; a roll's own barcode
  may equal its own roll number); the barcode generator skips numbers already on rolls; the
  server refuses portal actions from operator logins; Savio bill no and vehicle no are copied
  onto ERPNext's Delivery Note. Cases: TC-IN (new clash case), TC-OS-016, TC-ROLE-001,
  TC-SELL-001 (🆕 fix).
- **D-58 Sync hold-back:** **kept** — when an entry for a roll is refused, that roll's later
  entries in the same sync wait until it is fixed. Case: TC-SYNC-006 stays as written.
- **D-59 Rolls page hint:** the hint under "Current weight" on a moved roll changes to "Saving adds
  a line to the roll's history (a count difference or store loss)." Only that sentence changes.
  Case: TC-COR-006 (🆕 fix).

---

**Review complete (2026-11-05):** all open questions answered (D-01 … D-59). Next: update the
245 test cases to these decisions, then the business re-reviews the catalog.
