# Update — 2026-11-05

The acceptance-question review is **complete**. All answers are in `decisions.md` (D-01 … D-59).
Decisions taken on 2026-11-05 (after the pause described in `session-summary-2026-11-04.md`):

| Topic | Decision |
|---|---|
| What is a design (D-30) | Papers auto-grouped across vendors by shared RT or Delta code (1,459 designs); 4 doubtful groups go to a review list |
| Minimum stock (D-33…D-37) | Alert at once if set below current stock · minimum 0 = alert when completely empty, empty box = not watched · each new drop = new alert · lowering/removing the minimum closes the alert · checked on current stock only |
| Alerts page (D-38…D-41, D-55) | Comment optional when reviewing · supervisor and super admin can reopen · supervisors can add notes to low-stock alerts · opens on open alerts, newest first |
| Godown move (D-42, D-43) | Every portal move adds a **new history line** ("Moved to another godown") with a real stock transfer; Running Godown allowed as a location (never counts as storage for minimum stock) |
| Opening stock (D-44…D-51) | GSM/width optional for now (future: fixed on the paper code and prefilled) · roll found in scan but not on sheet → register on tablet · scanned godown wins · duplicate rows → both rejected · re-load never changes loaded rolls, only reports differences · separate "Old stock loaded" report column · old floor rolls: operator picks the godown on return · old rolls at zero value |
| Roles (D-52…D-54) | Only **super admin (dev team), supervisor, operator** — no admin role · deleting a roll with history: supervisor and super admin · a godown can be deactivated while its roll is out; operator picks a godown on return |
| Bugs (D-56…D-59) | Fix all stock bugs (finished rolls coming back, double Consume, godown required, remark codes checked) · fix all other bugs (barcode/roll-number clash, generator skips used numbers, operators blocked on the server, bill/vehicle on ERPNext Delivery Note) · keep sync hold-back · fix the Rolls-page "Current weight" hint text |

**Action for the business:** share a sample stock-take sheet and photos of old roll labels.

**Next step:** update the 245 test cases to these decisions; the business re-reviews the
catalog; then automate (✅ cases first, then failing tests for each fix and new feature).
