# Royale Touche inventory — decisions (4–5 Nov 2026)

Royale Touche's roll inventory (tablet app + admin portal) is moving to a new backend
(ERPNext). Before writing the acceptance tests we went through every open question with the
business. This page lists each question and what was decided.

**Roles in the system:** super admin (the development team), godown supervisor, and operator
(tablet only). There is no "admin" role.

**Status words used below:** *Fix* = today's system does something wrong and will be corrected.
*New* = a feature that doesn't exist yet and will be built.

---

## 1. The inventory scenarios

| Scenario | Decision |
|---|---|
| Enter a roll, use it with remarks, inward/outward on different dates, return to vendor, sale | Already supported |
| Move a roll from one godown to another | Done on the portal (change the roll's location) — see section 8 |
| Return **part** of a roll to the vendor | *New* — enter the kg of the piece |
| Sell **part** of a roll | *New* — enter the kg of the piece; the rest stays in stock |
| A roll loses weight while sitting in the store (100 kg recorded, 80 kg found at outward) | *New* — booked as **store loss** with an alert |
| Minimum stock per design | *New* — alert when a design runs low |
| How alerts reach people | A **portal Alerts page** only (no email / WhatsApp) |

## 2. Dates

| Question | Decision |
|---|---|
| Which day is paper counted as consumed? | The **return day** (paper out on 28 Sep, back on 3 Oct → October) |
| An entry dated before the roll's last movement (e.g. a sale dated yesterday on a roll received today) | **Refused** *(Fix)* |
| An entry saved offline on the tablet that reaches the server days later | **Refused if saved more than 2 days earlier**; the operator re-enters it *(Fix)* |
| How far back can entries be dated? | **Today or yesterday** for everything: movements, registration and stock counts. Only the opening-stock load is exempt *(Fix)* |

## 3. Reports

| Question | Decision |
|---|---|
| A stock count that finds less than the system says (even 0) | Industry standard: it is not consumption. A fully used roll is recorded as **Consumed**; a count that finds less is **Store loss** with an alert; a count that finds more is **Adjusted** |
| "Last movement recorded at" in the daily roll report | The time the **operator saved it on the tablet** *(Fix)* |
| Empty "Roll note" column | **Filled** with the roll's note (and the note entered at registration is kept) *(Fix)* |
| Deleting a roll changes past reports | **Not allowed if the roll has movements in a previous (closed) month**; allowed within the current month *(Fix)* |
| Financial-year report | A **custom from–to date range** on the reports (covers a year or any period) *(New)* |
| Year end (1 April) | The system **creates the next financial year automatically** and **alerts the team in advance** (success or failure) *(New)* |
| Where the new "Store loss" column goes | After Adjusted: Opening · Received · Consumed · Returned to vendor · Sold · Adjusted · Store loss · Closing · Out on floor |
| History wording | "Counted 50 kg less / more"; an inward top-up on an existing roll shows under **Adjusted**, not Received *(Fix)* |

## 4. Partial return to vendor and partial sale *(New)*

| Question | Decision |
|---|---|
| What the operator enters | The **kg of the piece going out** (1000 kg roll, 250 kg cut → 750 kg stays) |
| Scale photo | **Required** on the tablet |
| Price | Prices stay **off** for now (Savio bills); later, per kg |
| Savio bill no / vehicle no | **Optional** |
| Screen | **Two buttons**: "Whole roll" and "Part of roll" |
| Remark on a return to vendor | **Optional** for whole and partial returns |
| Where it can be recorded | **Tablet and portal** (photo required only on the tablet) |
| A tiny leftover after cutting | Nothing special; it stays on the roll |

## 5. Store loss *(New)*

| Question | Decision |
|---|---|
| Scale tolerance | **10 kg** — smaller differences are ignored. It must be a setting that can be changed later without code |
| How much is booked | The **whole difference** (100 recorded, 80 weighed → 20 kg loss; the roll goes out at 80) |
| Approval | Stock **drops immediately**; a supervisor reviews the alert afterwards |
| Scale shows more than recorded | Stock **stays**; a "weighed heavier" alert is raised |
| Scale reads 0 | **Refused** ("check the scale"); a roll that is really gone is handled with a stock count |
| A typing mistake (8 typed instead of 80) | The supervisor corrects the weight on the portal's Rolls page |
| Warning to the operator | A **confirm screen** before booking: "Recorded 100 kg, you weighed 80 kg — 20 kg will be booked as store loss" |
| Date on the alert | The **day the roll was weighed** |
| Which godown the loss comes from | The godown the roll was in when weighed |

## 6. Minimum stock per design *(New)*

| Question | Decision |
|---|---|
| Unit | **kg** |
| What is "a design" | Papers that share an **RT code or a Delta code** are one design, **across all vendors** (1,459 designs). 4 doubtful groups go to the team to confirm |
| What stock counts | Rolls **in storage godowns** only (rolls out on the production floor don't count) |
| Who sets minimums | **Supervisor and super admin** |
| Minimum set while stock is already below | Alert opens **at once** |
| Minimum of 0 | Means "**alert when completely empty**"; an empty box means the design isn't watched |
| A design runs low, recovers, runs low again | A **new alert** each time |
| Minimum lowered or removed while an alert is open | The alert **closes by itself** with a note |
| Backdated entries | The check uses **current stock only** |

## 7. Alerts page *(New)*

| Question | Decision |
|---|---|
| Who sees it | Supervisor and super admin |
| Comment when marking reviewed | **Optional** |
| Reopening a reviewed alert | **Supervisor and super admin** |
| Notes on a low-stock alert | Supervisors can **add notes** ("ordered 5 rolls, arriving Friday"); it still closes only when stock recovers |
| What shows when the page opens | **Open alerts, newest first**; filters for reviewed/closed and dates |

## 8. Moving a roll between godowns

| Question | Decision |
|---|---|
| How a move shows in the roll's history | A **new history line** on the day of the move ("Moved to another godown"), with the stock moved in ERPNext. The roll is only ever in one godown *(Fix)* |
| Choosing "Running Godown" (production floor) as a location on the portal | **Allowed**; such a roll never counts as "in storage" for minimum stock |

## 9. Loading the existing stock at go-live *(New)*

The godowns hold 300–1,500 rolls that were never in any system. They are loaded once, over 2–3
days, godown by godown.

| Question | Decision |
|---|---|
| Method | The team fills a **stock-take spreadsheet**; it is loaded; operators then **scan every roll** on the tablet to confirm it |
| Weight | What the roll **weighs today** (arrival weight = current weight) |
| Arrival date | The day the roll is loaded |
| Challan / lot | **"OLD RECORD"**, so old stock is recognisable |
| In the reports | A separate **"Old stock loaded"** column, so every day still adds up |
| GSM and width | **Optional** for now. Later they become part of the paper code and are filled in automatically when the paper is chosen |
| A roll found during the scan but not on the sheet | **Registered on the tablet** right there as old stock |
| A roll scanned in a different godown than the sheet says | **The scan wins**; the godown is corrected |
| The same roll number or barcode twice in the sheet | **Both rows rejected** and listed for correction |
| Loading a corrected sheet again | Already-loaded rolls are **never changed**; differences are only **reported** |
| Rolls on the production floor at go-live | Loaded as "Out"; when they come back the **operator picks the godown** |
| Value of old rolls | **Zero** (no price) |
| Minimum-stock values | Set **after** the load |

**Needed from the business:** a sample stock-take sheet, and photos of a few old roll labels.

## 10. Roles

| Question | Decision |
|---|---|
| Roles used | **Super admin (dev team), supervisor, operator** — no admin role |
| Who may delete a roll that has history | **Supervisor and super admin** (never the operator) |
| Deactivating a godown while one of its rolls is out on the floor | **Allowed**; the operator picks another godown when it comes back |

## 11. Problems found in today's system — all to be fixed

| Problem today | Fix |
|---|---|
| A sold / consumed / returned roll can get kg back through a stock count or inward | Refused |
| "Consume" pressed twice adds a second history line | Refused |
| A roll can be registered without a godown | Godown required |
| Any remark code is accepted (e.g. "NOPE") | Only codes from the Remarks list |
| One roll's roll number can equal another roll's barcode, so search opens the wrong roll | A code already used on another roll is refused |
| The barcode generator can print a number already on a roll | Used numbers are skipped |
| An operator is blocked only on the portal screen, not on the server | Blocked on the server too |
| Savio bill no and vehicle no aren't on ERPNext's sale record | Copied there too |
| The Rolls page hint "no new movement" is wrong for moved rolls | Text corrected |

**Kept as it is:** when a tablet sync contains an Outward that is refused, the Return for the same
roll waits until the Outward is fixed (you can't return a roll that never went out).

---

**Next step:** the 245 acceptance test cases are updated to these decisions and reviewed again;
then the tests are automated and the fixes and new features are built.
