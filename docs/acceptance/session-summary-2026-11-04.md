# Session summary — Royale Touche on ERPNext (2026-11-04)

A handover for anyone (person or Claude) picking this work up. Written as questions and answers.
Paused in the middle of the acceptance-question review (topic 5 of 12, question Q30).

---

## 1. Context

**Q: What is the project?**
A: Royale Touche (a laminate maker) tracks decor-paper rolls in its godowns: a tablet app for
operators (register, outward, return, return to vendor, sale) and a React admin portal. The
backend is moving from Node/MongoDB to **ERPNext 16** through a custom Frappe app
`royal_touche`. Savio stays their main ERP; ours is warehouse/inventory only.

**Q: What was decided at the start?**
A: Retire Node · own Google Cloud VMs · MariaDB · **no Docker anywhere** (native bench locally
and on servers) · standard ERPNext APIs plus custom business-action endpoints · stored login
tokens (ERPNext OAuth Bearer Token table, our own login endpoint) · Godown Operator is app-only
· price designed in but switched off · Savio bill no optional · a "Direct Sale" default buyer ·
no buyer picker · the app and portal keep their UI and behaviour exactly.

**Q: How does the domain map onto ERPNext?**
A: Roll = **Batch** (custom `rt_*` fields) · arrival = one **Purchase Receipt** per roll ·
movements = **Stock Entry** (issue/transfer/receipt), **Purchase Return** (return to vendor),
**Delivery Note** (sale) plus our **Roll Movement** record · godowns = **Warehouse** · materials
= **Item** · vendors = **Supplier** with a **Vendor Paper** child table (RT code / Delta code /
supplier code) · our doctypes: Roll Movement, Roll Lot, RT Remark, Barcode Batch, Sync Log.

**Q: Where is everything?**
A:
- Backend + portal repo: `/home/trt-074/Documents/extraction/extraction`, branch
  **`feature/erpnext-backend`** (GitHub, pushed; no PR yet by the user's choice).
  - Frappe app: `erpnext/royal_touche/royal_touche/`
  - Portal: `frontend/` (React + Vite). `npm run dev:erp` points it at local ERPNext.
  - Design: `docs/superpowers/specs/2026-11-03-erpnext-backend-design.md`
- Tablet app repo: `/home/trt-074/Documents/extraction/royal-touche-fe`, branch
  `feature/erpnext`, flavour `erp`. **The user pushes this repo** (GitLab has no credentials here).
- Local setup: native bench at `~/frappe-bench`; private MariaDB on port **3307**
  (`erpnext/scripts/local-mariadb.sh start`); `cd ~/frappe-bench && bench start`.
  Sites: **`rt.localhost`** = the user's live dev data · **`rt-test.localhost`** = automated tests.

**Q: Any traps to know before touching anything?**
A:
- **Port 8000 always serves `rt.localhost`**, whatever Host header you send. Tests or probes
  against the test site need their own server:
  `bench --site rt-test.localhost serve --port 80xx --noreload`.
- Subagents must **never write to `rt.localhost`** and never curl :8000.
- Running test modules **in parallel on the same test site** causes MariaDB deadlocks in setUp
  — a collision, not a bug; rerun.
- On tablet tests **the user does every tap**; Claude only watches logs, DB and screenshots.
- Never print tokens, passwords or DB URIs. **Commit or push only when the user asks.**
- In Playwright, clicking the barcode **Print** button opens Chrome's real print dialog and
  freezes automation — don't click it; the user checks Print by hand.

---

## 2. What is done

**Q: What is the state of the four plans?**
A:

| Plan | State |
|---|---|
| 1. Backend core on ERPNext | ✅ done |
| 2. Tablet app on ERPNext (translation layer `ErpRoyalTouchApi`) | ✅ done, tested on the tablet (sync, offline, photos, soft delete) |
| 3. Portal on ERPNext | ✅ done today, clicked through end to end, pushed |
| 4. Servers (GCE), file storage, OAuth client, data import, cut-over | ⏳ next |

**Q: What did Plan 3 (portal) change?**
A: Only `frontend/src/api/*.ts` on the portal side (pages untouched), plus backend endpoints
`api/portal_lots.py`, `portal_masters.py`, `portal_reports.py`, `portal_rolls.py`,
`portal_users.py`, shared `portal.py`, and `roll_corrections.py` (Rolls-page edits of weight /
material / godown become proper stock postings). Built by 5 parallel agents, then reviewed by
an independent reviewer; all Critical/Important findings fixed.

**Q: Which bugs were fixed during Plan 3?**
A:
- Lot/roll photos showed as broken images (Vite dev proxy didn't forward `/private/files`).
- Reopening the portal after the 1-hour token expiry logged the user out (refresh never ran on `auth.me`).
- Logged-out pages (login, forgot/reset password) sent a stale token and got 401.
- Permission refusals reached the browser without a message.
- Reset/invite links also worked on ERPNext's own password endpoint with no expiry. They now
  live in their own hashed fields with purpose + expiry; ERPNext's endpoint returns 410.
- Reset links were written to logs on servers (now only in developer mode).
- Upload file names, a portal-vs-tablet race on one roll, unique barcode runs, price drift on
  re-registration, "Page 1 of 0", and the label size not being saved.
- About 1,400 lines of unused printer code removed (ZPL, QZ Tray, TSPL, PDF downloads); labels
  print through the browser's own Print dialog.

**Q: How was it verified?**
A: The full backend suite passes (**376 integration + 47 unit tests**), `tsc` and the production
build pass, and a Playwright click-through covered every portal page on `rt.localhost`. The
ERPNext ledger matched the rolls after every step (0 mismatches). All E2E test data was then
deleted; the dev site holds the user's 4 rolls (08, 03, 02, 100).

**Q: What is pushed?**
A: `feature/erpnext-backend` up to `107b0d9`:
`b2e1302`, `2c88ba5` (portal foundation, private photos), `581db20` (portal endpoints),
`f8b1eb2` (portal API layer), `107b0d9` (drop unused printer code).

**Q: What does Plan 4 need for the portal?**
A: Site config `rt_portal_url` (invite/reset links) · an outgoing Email Account · upload the APK
(Download app page) · the reverse proxy must route `/api`, `/private/files` and `/files` to ERPNext.

---

## 3. Acceptance testing (in progress)

**Q: What did the user ask for?**
A: Acceptance cases for every inventory scenario: enter a roll; use it and add remarks; inward
and outward on different dates; return to vendor; sale; godown-to-godown move; partial return;
partial sale; a kg discrepancy alert (100 kg in, 80 kg found at outward); minimum stock per
design with alerts. Then: how to load the **existing physical stock** at go-live. Then: write
test cases first and review them before any test code.

**Q: What documents exist?** (all under `docs/acceptance/`, **not committed yet**)
A:
- `2026-11-04-inventory-acceptance.md`: acceptance criteria AC-01..AC-10, invariants I-1..I-6,
  timelines T-1..T-6, extra cases E-1..E-8, golden dataset, opening stock OS-1..OS-8.
- `test-cases/README.md` + `01-core-movements.md` (76) + `02-new-features.md` (52) +
  `03-dates-reports-sync.md` (53) + `04-opening-portal-roles.md` (64) = **245 cases**
  (161 ✅ today · 76 🆕 to build · 8 🔶 value to confirm). All 109 rows in the 26 day-by-day
  tables balance. A coverage table maps every criterion to its cases.
- `decisions.md`: the decisions log, D-01..D-32 so far.
- this file.

**Q: How will testing work?**
A: Three layers:
1. Automated **timeline tests** with a controlled clock: replay days through the tablet's sync
   API and check the roll, the ERPNext stock as of each day, and every report.
2. A **golden dataset** of 13 rolls over ~4 weeks; the business fills the expected report
   numbers by hand and the system must match every cell.
3. A **manual pass** on the tablet and portal.

**Q: What is supported today vs to build?**
A: ✅ today: enter a roll, remarks, different dates, whole return to vendor, whole sale, godown
move (portal location edit), return from the floor with part used, selling a used roll's
leftover.
🆕 to build: partial return to vendor by kg, partial sale by kg, store loss at outward + alert,
minimum stock per design + alert, Alerts page, opening-stock loader, and the bug fixes below.

**Q: What bugs did writing the cases uncover in today's code?** (full list in `test-cases/README.md`)
A:
1. Dates only half-checked: registration accepts any date; counts and top-ups can be backdated
   by weeks; a movement dated before the roll's last one is accepted (a sale dated yesterday on
   a roll received today gives yesterday's closing −1000).
2. Finished rolls can come back to life (a count or top-up on a consumed/sold roll; the tablet
   sync path allows it, the portal refuses it).
3. No limit on how old an offline entry can be.
4. Rolls can end up "In stock" on the production floor (4 different paths).
5. 1 April fails if ERPNext's job doesn't create the next fiscal year.
6. Remarks lost: registration notes and codes dropped; movement remark codes not validated;
   the daily report shows only the last note of the day.
7. Operators are blocked from the portal only on screen; the server still accepts their token
   for roll edit/delete.
8. Plus smaller ones: Savio bill/vehicle not on the Delivery Note, ambiguous history text, a
   barcode can equal another roll's number, the barcode generator doesn't check old labels,
   admin's portal shows only User management.

---

## 4. Decisions so far (Q → A)

Full wording in `decisions.md`.

**Godown move, partial movements, notifications, opening stock** (asked before the review):
- Godown A → B? → **Portal location edit is enough** (no tablet transfer, no history row).
- Partial return to vendor / partial sale? → **Yes, by kg, both.**
- Discrepancy meaning? → A roll **loses weight while sitting in the store** (100 in, 80 at outward).
- Notifications? → **Portal Alerts page only.**
- Existing stock? → **Spreadsheet + tablet scan-check.** 300–1,500 rolls, a 2–3 day stock-take.
  Weight today = arrival weight; arrival date = load day; challan/lot **"OLD RECORD"**. Vendor,
  design and floor rolls are known. Old rolls must show as **Opening**, not Received.

**Topic 1: Dates**
- D-01 Which day is consumption counted? → **Return day** (as today and in Node).
- D-02 Movement dated before the roll's last movement? → **Refuse.**
- D-03 Old offline entries? → **Refuse if saved more than 2 days before they reach the server.**
- D-04 Backdating for registration and counts? → **Today or yesterday for all**; opening-stock load excepted.

**Topic 2: Reports**
- D-05 A physical count finding less (even 0)? → Industry standard: consumption ≠ stock-take
  variance. A fully used roll is recorded as **Consumed**; a count shortfall is **Store loss
  with an alert** (same as AC-09); a count finding more stays **Adjusted**.
- D-06 "Last movement recorded at"? → **When the operator saved it on the tablet.**
- D-07 Empty "Roll note" column? → **Fill it** (and keep the registration note).
- D-08 Deleting a roll vs signed past reports? → **Refused if the roll has movements in a closed (previous) month.**
- D-09 Financial-year view? → **Custom from–to date range** instead.
- D-10 Year end? → **Create the next fiscal year automatically AND alert the team in advance**
  (success or failure) on the Alerts page.
- D-11 Store loss column? → **After Adjusted.**
- D-12 History text? → "**Counted 50 kg less / more**"; inward top-up reports under **Adjusted**, not Received.

**Topic 3: Partial return to vendor / partial sale**
- D-13 What kg is entered? → **The piece going out.**
- D-14 Scale photo? → **Required** (on the tablet).
- D-15 Price? → **Off for now**; per kg when switched on.
- D-16 Bill no / vehicle no? → **Optional.**
- D-17 Whole vs part? → **Two buttons** ("Whole roll" / "Part of roll").
- D-18 Return-to-vendor remark? → **Optional for both** whole and partial.
- D-19 Where can partials be recorded? → **Tablet and portal** (no scale photo on the portal).
- D-20 Tiny leftover? → **Nothing special.**

**Topic 4: Store loss**
- D-21 Tolerance? → **10 kg**, and it must be an **admin-changeable setting**.
- D-22 Loss amount? → **The whole difference.**
- D-23 Approval? → **Stock drops immediately; the supervisor reviews afterwards.**
- D-24 Weighed heavier? → **Stock stays; alert.**
- D-25 Scale reads 0? → **Refuse.**
- D-26 Undo a mistyped weight? → **Portal Rolls-page weight correction** (booked under Adjusted).
- D-27 Warn the operator first? → **Yes, a confirm screen.**
- D-28 Alert date? → **The movement date.**

**Topic 5: Minimum stock** (in progress)
- D-29 Unit? → **kg.**
- D-30 What is a design? → **OPEN.** See the next section.
- D-31 What counts? → **Rolls in storage only** (not the floor).
- D-32 Who sets minimums? → **Supervisor and above.**

---

## 5. Where we paused, and what is left

**Q: What was the last open question?**
A: **Q30: how to define a "design" so each design's total available kg can be known.**
The user asked how this can be defined. Analysis of the 1,531 papers in `docs/vendors-seed.json`:
- 955 RT code only · 442 Delta code only · 134 both.
- 42 RT codes and 35 Delta codes appear under more than one vendor.
- Proposal: **auto-group** papers that share an RT code or a Delta code (or are linked by a paper
  carrying both) into one design across vendors. That gives 1,459 designs. Design total kg =
  sum of rolls in storage godowns whose paper belongs to it. 4 groups join two RT spellings via
  one Delta code (e.g. `129A` and `129 / 1129` via Delta `398`) and need a human check.
- Alternatives: "RT code, else Delta code" (simpler; may split a design), or per vendor's paper.

**Q: Which questions are still to go?** (order planned: 5 → 12)
A:
- **5. Minimum stock (rest):**
  - Does a minimum set above current stock alert at once?
  - Is a minimum of 0 the same as none?
  - After recovery and a new drop, a new alert or reopen the old one?
  - Does lowering or removing the minimum close the alert?
  - Is the check on current stock only (no alerts for backdated movements)?
- **6. Alerts page:**
  - Does the store manager see it?
  - Is a comment mandatory when marking reviewed? Can a reviewed alert be reopened?
  - Can a supervisor acknowledge a low-stock alert without closing it?
  - Is "Closed" separate from "Reviewed", and what is the default view?
  - Which date does the date filter use?
  - Admin's access to the Alerts page.
- **7. Godown move:**
  - Is re-posting the receipt OK for an unmoved roll (vs a transfer)?
  - Should a location edit to Running Godown be refused?
- **8–11. Opening stock** (12 questions, end of `test-cases/04-opening-portal-roles.md`):
  - sample sheet; rolls found during the scan pass that aren't on the sheet;
  - duplicates within the sheet; re-run with a changed row;
  - how the staggered 2–3 day load shows in Opening;
  - which godown floor rolls return to; value / rate of old rolls;
  - label prefix and old label format; error wording.
- **12. Roles and remaining bugs:**
  - What does admin see on the portal?
  - Who may delete a roll with history?
  - Deactivating a godown while its roll is out.
  - Yes/no on the bugs not yet covered by a decision: finished rolls coming back to life;
    "In stock" on the floor; remark validation; bill/vehicle on the Delivery Note; barcode vs
    roll-number clash; barcode generator vs old labels; operator token on portal endpoints;
    one failed sync item holding back later ones; the "no new movement" hint on the Rolls page.
- Also confirm the remaining 🔶 values in `test-cases/02-new-features.md`.

**Q: What happens after the questions?**
A:
1. Update the 245 cases with the decisions (statuses, expected values, new cases).
2. The user reviews the updated catalog.
3. Automate the ✅ cases with the same IDs (timeline harness with a controlled clock).
4. Turn agreed bug fixes into failing tests first, then fix.
5. Build the 🆕 features (needs small tablet changes: two-button whole/part screens, kg + scale
   photo for partials, outward weight sent as data, confirm screen for store loss).
6. Opening-stock loader with validation report and rehearsal mode.
7. Plan 4 (servers, cut-over).

Nothing in `docs/acceptance/` is committed yet; commit only when the user asks.
