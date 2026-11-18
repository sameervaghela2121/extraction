# ERPNext Backend — Plan 1 of 4: Core app on a local bench

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Frappe app `royal_touche`, running on ERPNext on this machine (no Docker), that does
everything the Node backend does for rolls, lots, movements, sync and reports, proven by tests.

**Architecture:** ERPNext supplies Items, Suppliers, Warehouses, Batches and the stock documents
(Purchase Receipt, Stock Entry, Delivery Note, Purchase Return, Stock Reconciliation). Our app adds
custom fields, a few DocTypes (Roll Lot, Roll Movement, RT Remark, Barcode Batch, Sync Log),
document hooks that hold the business rules, whitelisted methods for the business actions, and
two Script Reports. Reading and simple master edits use Frappe's standard REST API.

**Tech Stack:** Frappe + ERPNext (newest `version-N` branch, pinned), Python (version required by
that Frappe branch, via `uv`), MariaDB 11.4 LTS (user-space, port 3307), Redis (bench-managed),
Node 24 + yarn (bench asset build).

**Spec:** `docs/superpowers/specs/2026-11-03-erpnext-backend-design.md`

**The four plans:** 1 = this (backend core, local). 2 = tablet app API rewrite. 3 = portal API
rewrite + Buyers page. 4 = GCE servers, GCS file storage, OAuth client for production, master
data import from prod, cut-over. Plans 2–4 are written after this one is merged.

## Global Constraints

- ERPNext core is never edited; everything lives in `royal_touche`.
- One Company: **Royale Touche**, abbreviation **RT**, currency INR, country India, time zone
  Asia/Kolkata, fiscal year starting 1 April.
- Perpetual inventory **on**. Every stock row we create sets `allow_zero_valuation_rate = 1`;
  every rate is 0 unless `rate_per_roll` is given.
- Stock UOM **kg**. Every roll is one **Batch** with batch-wise valuation on.
- Roll statuses, exactly: `IN_STOCK`, `ISSUED`, `CONSUMED`, `RETURNED_TO_VENDOR`, `SOLD`.
- Movement types, exactly: `IN`, `OUT`, `RETURN`, `ADJUSTMENT`, `CONSUME`, `RETURN_TO_VENDOR`, `SELL`.
- Roll numbers, barcodes, codes (vendor, material, location, remark) stored **upper-case**,
  trimmed. Roll number and barcode unique among **live** (not deleted) rolls.
- App-facing DocTypes use `autoname: hash` (lowercase ids).
- Nothing app-facing is hard-deleted: masters are disabled, rolls and movements marked deleted.
- Business-rule messages are copied **verbatim** from the Node code where the plan quotes them.
- Movement dates: operator-dated types (`OUT`, `RETURN`, `CONSUME`, `RETURN_TO_VENDOR`, `SELL`)
  must fall on the IST day of `recorded_at` or the day before, and never after the server's IST
  today.
- Sync batch: max **50** items; each item has its own `client_id`; item results are
  `ok` / `failed` / `skipped`; reasons `validation`, `duplicate`, `conflict`, `not_found`,
  `forbidden`, `server_error`, `dependency_failed`.
- Max **4** photos per movement.
- Godown roles (`Godown Supervisor`, `Godown Operator`) have **no** create/submit permission on
  Stock Entry, Purchase Receipt, Delivery Note, Stock Reconciliation; our methods create those
  with `ignore_permissions` after checking our own rules.
- Price fields (`rate_per_roll`) at **permlevel 1**, readable only by `RT Super Admin`,
  `RT Admin` (and System Manager).
- Source of truth for behaviour: `backend/src/services/stock.service.ts` (`applyToRoll`),
  `materialRolls.service.ts`, `sync.service.ts`, `consumptionReport.service.ts`,
  `dailyRollReport.service.ts`, `barcodeBatches.service.ts`.

## Review Focus

1. **The same `client_id` arriving twice** (retry while the first is still in flight, or a
   double tap) → exactly one record; the second call returns the first one's result. Pinned in
   Task 5 and Task 9.
2. **A late offline movement dated yesterday** arriving after newer movements on other rolls →
   accepted; ledger agreement still holds after ERPNext's back-dated repost. Pinned in Task 7.
3. **A roll registered with no location** → stock sits in `Unassigned - RT`; the roll's
   location reads empty, as clients show "-" today. Pinned in Task 5.
4. **Case differences** in scanned barcodes and typed roll numbers → treated as the same code
   for both lookup and uniqueness. Pinned in Task 5.
5. **Deleting a roll that already has movements** → succeeds; its stock documents are cancelled
   newest first; the batch's stock is back to 0; the roll and its movements show as deleted in
   a `modified`-filtered read. Pinned in Task 8.

---

## File Structure

Repo root = `extraction/`. New top-level folder `erpnext/`:

```
erpnext/
  README.md                         how to set up and run locally
  scripts/local-mariadb.sh          download/init/start user-space MariaDB on 3307
  scripts/local-bench.sh            bench init, get erpnext, link our app, create sites
  royal_touche/                     the Frappe app (pyproject.toml, MANIFEST etc.)
    royal_touche/
      hooks.py                      doc_events, fixtures, after_install
      setup/install.py              company, settings, warehouses, roles (idempotent)
      errors.py                     error classes carrying sync reasons
      dates.py                      IST day helpers + operator date rule
      replay.py                     client_id replay lookup
      rolls.py                      register / update / set remarks / delete
      movements.py                  the movement engine (one function per type)
      stock_docs.py                 builders for ERPNext stock documents
      checks.py                     ledger agreement check, stock summary
      sync.py                       sync batch runner
      api/                          thin whitelisted wrappers: auth, rolls, movements,
                                    sync, stock, app
      royal_touche/doctype/         roll_lot, roll_movement, rt_remark, barcode_batch,
                                    sync_log, vendor_paper, rt_remark_link
      royal_touche/report/          consumption/, daily_roll_status/
      fixtures/                     custom_field.json, role.json, custom_docperm.json
      tests/                        test_*.py, factories.py, fixtures/*.json
backend/src/utils/exportSeedScenario.ts   writes the seed scenario + expected figures as JSON
```

The bench itself lives **outside** the repo at `~/frappe-bench`; `apps/royal_touche` is a
symlink to `erpnext/royal_touche`. Sites: `rt.localhost` (dev) and `rt-test.localhost`
(tests, `allow_tests: true`).

Test command used throughout:
`cd ~/frappe-bench && bench --site rt-test.localhost run-tests --app royal_touche --module royal_touche.tests.<module>`

Test base class: the framework's integration test case (`IntegrationTestCase` on v16,
`FrappeTestCase` on v15). Shared helpers live in `tests/factories.py` (Task 3 creates it).

---

### Task 1: Local ERPNext without Docker

**Files:**
- Create: `erpnext/scripts/local-mariadb.sh`, `erpnext/scripts/local-bench.sh`, `erpnext/README.md`

**Interfaces:**
- Produces: MariaDB on `127.0.0.1:3307` (data in `~/.local/share/rt-mariadb`), bench at
  `~/frappe-bench` with `erpnext` installed on `rt.localhost` and `rt-test.localhost`,
  ERPNext set up for Royale Touche (Global Constraints values).

- [ ] **Step 1: Write `local-mariadb.sh`** — subcommands `init | start | stop | status`.
  Downloads the MariaDB 11.4 LTS generic Linux tarball from archive.mariadb.org into
  `~/.local/opt/mariadb`, runs `mariadb-install-db` with its own datadir, starts `mariadbd`
  on port 3307 with its own socket and pid file and these server settings:
  `character-set-server=utf8mb4`, `collation-server=utf8mb4_unicode_ci`,
  `skip-character-set-client-handshake`. Never touches the system MySQL on 3306.
  If the binary needs a missing system library (e.g. `libaio`), the script prints the exact
  `sudo apt install …` line for the user to run and stops.
- [ ] **Step 2: Run it**

  Run: `erpnext/scripts/local-mariadb.sh init && erpnext/scripts/local-mariadb.sh start && erpnext/scripts/local-mariadb.sh status`
  Expected: `running on 3307`; `mysql -h127.0.0.1 -P3307 -uroot -p… -e "select version()"` prints `11.4.x-MariaDB`.
- [ ] **Step 3: Write `local-bench.sh`** — reads the newest `version-N` branch of
  `frappe/frappe`, reads its `requires-python`, installs that Python with `uv python install`,
  installs the `frappe-bench` CLI with `uv tool install`, then `bench init ~/frappe-bench
  --frappe-branch version-N --python <that python>`, `bench get-app erpnext --branch version-N`,
  creates both sites with `--db-host 127.0.0.1 --db-port 3307`, installs `erpnext` on both,
  sets `allow_tests` on `rt-test.localhost`, and completes the ERPNext setup wizard
  non-interactively with the Global Constraints values. Prints the chosen version.
- [ ] **Step 4: Run it and verify**

  Run: `erpnext/scripts/local-bench.sh && cd ~/frappe-bench && bench --site rt.localhost list-apps`
  Expected: `frappe` and `erpnext` listed; `bench --site rt.localhost execute frappe.db.get_value --args "['Company','Royale Touche','abbr']"` prints `RT`.
- [ ] **Step 5: README** — prerequisites, the two scripts, `bench start`, login URL
  `http://rt.localhost:8000`, how to run tests, how to stop MariaDB.
- [ ] **Step 6: Commit**

  ```bash
  git add erpnext/
  git commit -m "chore(erpnext): local MariaDB and bench setup without Docker"
  ```

---

### Task 2: App skeleton, install-time setup, roles

**Files:**
- Create: `erpnext/royal_touche/` (via `bench new-app royal_touche` in a temp dir, then moved
  into the repo and symlinked into `~/frappe-bench/apps/`), `royal_touche/setup/install.py`,
  `royal_touche/fixtures/role.json`
- Modify: `royal_touche/hooks.py`
- Test: `royal_touche/tests/test_setup.py`

**Interfaces:**
- Produces: `royal_touche.setup.install.after_install() -> None` (idempotent, also exposed as
  `royal_touche.setup.install.ensure_setup`); roles `RT Super Admin`, `RT Admin`,
  `Godown Supervisor`, `Godown Operator`; warehouse `Unassigned - RT`; constant
  `royal_touche.setup.install.UNASSIGNED_WAREHOUSE = "Unassigned - RT"`.

- [ ] **Step 1: Write the failing test** `test_setup.py`:

  ```python
  def test_install_is_complete_and_idempotent(self):
      ensure_setup(); ensure_setup()
      self.assertEqual(frappe.db.get_single_value("Stock Settings", "allow_negative_stock"), 0)
      self.assertTrue(frappe.db.get_value("Company", "Royale Touche", "enable_perpetual_inventory"))
      self.assertTrue(frappe.db.exists("Warehouse", "Unassigned - RT"))
      for role in ("RT Super Admin", "RT Admin", "Godown Supervisor", "Godown Operator"):
          self.assertTrue(frappe.db.exists("Role", role))
      self.assertEqual(frappe.db.count("Warehouse", {"warehouse_name": "Unassigned"}), 1)
  ```
- [ ] **Step 2: Run, expect FAIL** (`ImportError: ensure_setup`)
- [ ] **Step 3: Implement `ensure_setup()`** — sets the above, stock UOM `Kg` exists, Stock
  Settings: valuation method Moving Average as default but batch-wise valuation not disabled;
  `after_install` calls it. Link the app: `bench --site <both> install-app royal_touche`.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): royal_touche app skeleton and install setup`

---

### Task 3: Masters — materials, vendors with papers, locations, remarks, buyers

**Files:**
- Create: doctypes `rt_remark` (fields `remark_code` Data unique, `label` Data, `sort_order`
  Int, `disabled` Check; autoname hash), `vendor_paper` (child: `paper_code`, `rt_code`,
  `delta_code`, `is_common` Check, `found_in`), `royal_touche/fixtures/custom_field.json`,
  `royal_touche/masters.py`, `royal_touche/tests/factories.py`
- Modify: `hooks.py` (doc_events `validate` on Supplier, Item, Warehouse, RT Remark)
- Test: `royal_touche/tests/test_masters.py`

Custom fields: Supplier `rt_vendor_code` (Data, unique), `rt_papers` (Table → Vendor Paper);
Item `rt_material_code` (Data, unique), `rt_sort_order` (Int); Warehouse `rt_location_code`
(Data, unique), `rt_godown` (Data), `rt_sort_order` (Int). Buyers are plain Customers.

**Interfaces:**
- Produces: `royal_touche.masters.normalise_code(value: str | None) -> str | None` (trim +
  upper, empty → None); factories `make_material(code="TISSUE") -> str`,
  `make_vendor(code="V001", papers=[{"paper_code": "55036-29", "rt_code": "868"}]) -> str`,
  `make_location(code="GODOWN-A-1") -> str`, `make_remark(code="DEFECT") -> str`,
  `make_buyer(name="Buyer One") -> str`, `make_lot(...) -> str` (added in Task 4) — each
  returns the record's `name`; `standard_locations() -> dict[str, str]` (creates the six
  locations of `docs/locations-seed.json`, keyed by code, e.g. `["RUNNING-1"]`);
  `make_user(role: str) -> str` (one of the four RT roles); `as_user(user)` context manager
  (sets and restores `frappe.session.user`).

- [ ] **Step 1: Failing tests**

  ```python
  def test_codes_are_stored_upper_case_and_trimmed(self):
      v = make_vendor(code="  v-low ")
      self.assertEqual(frappe.db.get_value("Supplier", v, "rt_vendor_code"), "V-LOW")
  def test_vendor_code_is_unique_ignoring_case(self):
      make_vendor(code="DUP1")
      with self.assertRaises(frappe.UniqueValidationError): make_vendor(code="dup1")
  def test_paper_codes_upper_case(self):
      v = make_vendor(code="V2", papers=[{"paper_code": "ab-1", "rt_code": "868", "delta_code": "d9"}])
      p = frappe.get_doc("Supplier", v).rt_papers[0]
      self.assertEqual((p.paper_code, p.rt_code, p.delta_code), ("AB-1", "868", "D9"))
  def test_materials_are_kg_and_batch_tracked(self):
      i = frappe.get_doc("Item", make_material("TISSUE"))
      self.assertEqual((i.stock_uom, i.has_batch_no, i.is_stock_item), ("Kg", 1, 1))
  def test_remark_code_unique_upper(self): ...  # same shape as vendor test
  def test_disabled_master_stays_readable(self):
      r = make_remark("OLD"); frappe.db.set_value("RT Remark", r, "disabled", 1)
      self.assertEqual(frappe.db.get_value("RT Remark", r, "disabled"), 1)
  ```
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** the doctypes, custom fields (exported as fixtures), `validate`
  hooks calling `normalise_code`, `make_material` creating Item with `stock_uom="Kg"`,
  `has_batch_no=1`, `create_new_batch=0`.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): masters with codes, vendor papers, remarks`

---

### Task 4: Roll Lot and Barcode Batch

**Files:**
- Create: doctypes `roll_lot` (`document_type` Select `challan`/`invoice`, `document_no`
  Data, `document_photo` Attach, `client_id` Data unique; autoname hash), `barcode_batch`
  (`prefix`, `date`, `from_number` Int, `to_number` Int, `kind` Select `barcode`/`qr`,
  `deleted` Check), `royal_touche/barcodes.py`
- Test: `royal_touche/tests/test_lots_barcodes.py`

**Interfaces:**
- Produces: `royal_touche.barcodes.next_number(prefix: str, date: str) -> int`;
  `royal_touche.barcodes.codes_of(batch_name: str) -> list[str]`; factory
  `make_lot(document_type="challan", document_no="4587", client_id=None) -> str`.

- [ ] **Step 1: Failing tests** — `document_type` outside challan/invoice fails with message
  `Pick challan or invoice`; `document_no` empty or > 100 chars fails; two lots with one
  `client_id` raise `frappe.UniqueValidationError`; `next_number("RT", "261103")` is `1` with no
  batches and `to_number + 1` of the highest live batch for that prefix+date otherwise; a
  **deleted** batch's numbers stay spent (next_number still counts it); `codes_of` regenerates
  the codes exactly as `barcodeBatches.service.ts` does (port `dateDigits` and `codeWidth`;
  assert one known code, e.g. prefix `RT`, date `261103`, from 1 to 3 → `RT2611030001`, …).
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** (port from `barcodeBatches.service.ts`).
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): roll lots and barcode batches`

---

### Task 5: Roll registration (Batch + Purchase Receipt + IN movement)

**Files:**
- Create: `royal_touche/errors.py`, `royal_touche/replay.py`, `royal_touche/stock_docs.py`,
  `royal_touche/rolls.py`, doctype `roll_movement`, doctype `rt_remark_link` (child: `remark`
  Link RT Remark)
- Modify: `fixtures/custom_field.json` (Batch fields below)
- Test: `royal_touche/tests/test_register.py`

Batch custom fields (prefix `rt_`): `rt_roll_number`, `rt_barcode`, `rt_roll_key` (Data,
**unique**; = roll number while live, NULL when deleted), `rt_barcode_key` (same idea for
barcode), `rt_vendor` (Link Supplier), `rt_lot` (Link Roll Lot), `rt_paper_code`, `rt_rt_code`,
`rt_delta_code`, `rt_gsm` (Float), `rt_width` (Float), `rt_original_weight` (Float),
`rt_remaining_weight` (Float), `rt_status` (Select, statuses), `rt_location` (Link Warehouse),
`rt_remark_codes` (Table MultiSelect → RT Remark Link), `rt_client_id` (Data unique),
`rt_deleted` (Check), `rt_purchase_receipt` (Link), `rt_tag_photo`, `rt_barcode_photo` (Attach).

Roll Movement fields: `roll` (Link Batch), `movement_type` (Select), `transaction_date`
(Datetime), `recorded_at` (Datetime), `material` (Link Item), `vendor` (Link Supplier),
`weight`, `used_weight`, `roll_weight_after` (Float), `issued_to`, `from_location`,
`to_location` (Link Warehouse), `remarks`, `remark_code`, `photos` (Table of attachments,
max 4), `buyer` (Link Customer), `savio_bill_no`, `vehicle_no`, `rate_per_roll` (Currency,
permlevel 1), `client_id` (Data unique), `deleted` (Check), `stock_doctype` (Link DocType),
`stock_docname` (Dynamic Link). Autoname hash. Not editable after insert except `deleted`
and `savio_bill_no`.

**Interfaces:**
- Produces:
  - `royal_touche.errors`: `RTError(frappe.ValidationError)` with `reason: str` and
    `http_status_code`; subclasses `RTValidation` (400, `validation`), `RTDuplicate` (409,
    `duplicate`), `RTConflict` (409, `conflict`), `RTNotFound` (404, `not_found`),
    `RTForbidden` (403, `forbidden`).
  - `royal_touche.replay.find(doctype: str, field: str, client_id: str | None) -> str | None`
  - `royal_touche.rolls.register_roll(data: dict) -> dict` — keys in: `roll_number`,
    `barcode?`, `lot`, `vendor`, `material`, `paper_code?`, `rt_code?`, `delta_code?`,
    `gsm`, `width`, `weight`, `location?`, `date`, `client_id?`, photos?; returns
    `roll_dict(batch_name)`.
  - `royal_touche.rolls.roll_dict(batch_name: str) -> dict` — `name`, `roll_number`,
    `barcode`, `status`, `weight` (original), `remaining_weight`, `location` (None when
    unassigned), `vendor`, `material`, `lot`, `gsm`, `width`, `paper_code`, `rt_code`,
    `delta_code`, `remark_codes` (list of RT Remark names), `client_id`, `deleted`, `modified`.
  - `royal_touche.rolls.find_roll(id_or_code: str) -> str` (Batch name; looks up barcode,
    then roll number, then name, case-insensitive; raises `RTNotFound("Roll not found")`).
  - `royal_touche.stock_docs.purchase_receipt(batch, supplier, item, qty, warehouse, rate_per_roll=None) -> str`

- [ ] **Step 1: Failing tests**

  ```python
  def test_register_creates_batch_receipt_and_in_movement(self):
      r = register_roll(base_roll(roll_number="r-100", barcode="rt2611030001", weight=150))
      self.assertEqual((r["roll_number"], r["barcode"], r["status"]), ("R-100", "RT2611030001", "IN_STOCK"))
      self.assertEqual((r["weight"], r["remaining_weight"]), (150, 150))
      pr = frappe.get_doc("Purchase Receipt", frappe.db.get_value("Batch", r["name"], "rt_purchase_receipt"))
      self.assertEqual((pr.docstatus, pr.items[0].qty, pr.items[0].batch_no), (1, 150, r["name"]))
      mv = frappe.get_all("Roll Movement", {"roll": r["name"]}, ["movement_type", "weight"])
      self.assertEqual(mv, [{"movement_type": "IN", "weight": 150}])
  def test_lot_is_required(self):
      with self.assertRaisesRegex(RTValidation, "Select the lot \\(challan or invoice\\) this roll came in on"):
          register_roll(base_roll(lot=None))
  def test_roll_number_unique_ignoring_case(self):
      register_roll(base_roll(roll_number="DUP")); 
      with self.assertRaisesRegex(RTDuplicate, "A roll with this number already exists"):
          register_roll(base_roll(roll_number="dup"))
  def test_barcode_unique_ignoring_case_and_found_by_lowercase_scan(self): ...
  def test_same_client_id_returns_the_first_roll(self):
      a = register_roll(base_roll(client_id=CID)); b = register_roll(base_roll(client_id=CID, roll_number="OTHER"))
      self.assertEqual(a["name"], b["name"]); self.assertEqual(frappe.db.count("Batch", {"rt_client_id": CID}), 1)
  def test_no_location_goes_to_unassigned_and_reads_empty(self):
      r = register_roll(base_roll(location=None)); self.assertIsNone(r["location"])
      self.assertEqual(batch_qty(r["name"], "Unassigned - RT"), 150)
  def test_inactive_material_or_vendor_rejected(self): ...   # messages from materialRolls.service.ts lines 248-266
  def test_paper_must_belong_to_vendor(self): ...            # "Paper RT 999 is not one of <vendor>'s papers"
  def test_weight_gsm_width_must_be_positive(self): ...      # "Weight must be greater than 0" etc.
  def test_batch_uses_batchwise_valuation(self): ...
  ```
  `base_roll(**over)` and `batch_qty(batch, warehouse)` go in `factories.py`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** in one DB transaction: replay check first (before uniqueness,
  as `materialRolls.service.ts` line ~503 explains), validations, Batch insert, Purchase
  Receipt submit (`ignore_permissions`), IN Roll Movement linking the receipt.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): roll registration with replay guard`

---

### Task 6: Movement engine

**Files:**
- Create: `royal_touche/dates.py`, `royal_touche/movements.py`
- Modify: `royal_touche/stock_docs.py` (transfer, issue, receipt, purchase return, delivery
  note, reconciliation builders)
- Test: `royal_touche/tests/test_movements.py`, `royal_touche/tests/test_dates.py`

**Interfaces:**
- Consumes: `find_roll`, `roll_dict`, errors, `replay.find`, `stock_docs.*` (Task 5).
- Produces:
  - `royal_touche.dates.ist_day(value: datetime | str) -> date`
  - `royal_touche.dates.check_operator_date(transaction_date, recorded_at, now=None) -> None`
    raising `RTValidation("The date cannot be in the future")` or
    `RTValidation("The date must be today or yesterday")`.
  - `royal_touche.movements.record_movement(data: dict) -> dict` — keys in:
    `movement_type`, `roll`, `transaction_date`, `recorded_at?`, `location?` (OUT),
    `returned_weight?` (RETURN), `weight?` (IN), `new_weight?` + `remarks` (ADJUSTMENT),
    `issued_to?`, `remarks?`, `remark_code?`, `photos?`, `buyer?`, `savio_bill_no?`,
    `vehicle_no?`, `rate_per_roll?`, `client_id?`. Returns `{"movement": <Roll Movement
    dict>, "roll": roll_dict(...)}`.

Arithmetic and messages: port `applyToRoll` in `backend/src/services/stock.service.ts`
exactly (OUT changes no weight; RETURN sets remaining = returned, used = before − returned,
0 returned → CONSUMED with no location; home = the last OUT's `from_location`; CONSUME is a
no-op on finished rolls; IN may not exceed the original weight; ADJUSTMENT to 0 → CONSUMED).
New for SELL: `buyer` required (`RTValidation("Pick the buyer")`); photo optional; bill no.,
vehicle no., rate optional. ERPNext documents per the spec §6 table.

- [ ] **Step 1: Failing date tests**

  ```python
  def test_yesterday_relative_to_recorded_at_ok(self):
      check_operator_date("2026-11-02T23:30:00+05:30", "2026-11-03T00:10:00+05:30", now=ist("2026-11-03 09:00"))
  def test_two_days_back_rejected(self):
      with self.assertRaisesRegex(RTValidation, "The date must be today or yesterday"):
          check_operator_date("2026-11-01T10:00:00+05:30", "2026-11-03T10:00:00+05:30", now=ist("2026-11-03 11:00"))
  def test_future_rejected_against_server_today(self): ...
  def test_utc_midnight_does_not_shift_ist_day(self):
      self.assertEqual(ist_day("2026-11-02T19:00:00Z"), date(2026, 11, 3))
  ```
- [ ] **Step 2: Failing movement tests** (each starts from a registered 150 kg roll at
  `GODOWN-A-1`):

  ```python
  def test_out_moves_whole_roll_to_location_without_weight_change(self):
      res = out(roll, location=RUNNING_1)
      self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"]), ("ISSUED", 150))
      self.assertEqual((batch_qty(roll, GODOWN_A_1), batch_qty(roll, RUNNING_1)), (0, 150))
  def test_out_twice_conflicts(self):  # "This roll is already out — record its return first"
  def test_return_80_of_150(self):
      out(roll, location=RUNNING_1); res = ret(roll, returned_weight=80)
      self.assertEqual((res["roll"]["status"], res["roll"]["remaining_weight"], res["roll"]["location"]), ("IN_STOCK", 80, GODOWN_A_1))
      self.assertEqual(res["movement"]["used_weight"], 70)
      self.assertEqual((batch_qty(roll, GODOWN_A_1), batch_qty(roll, RUNNING_1)), (80, 0))
  def test_return_zero_means_consumed_with_no_location(self): ...
  def test_return_heavier_rejected(self):  # "This roll went out with 150 kg — it cannot come back heavier at 160"
  def test_return_when_not_out_conflicts(self): ...
  def test_consume_issued_roll(self): ...           # status CONSUMED, remaining 0, stock 0
  def test_consume_finished_roll_is_noop(self): ...  # no stock document, movement weight 0
  def test_return_to_vendor_from_stock(self): ...    # Purchase Return against the roll's receipt, qty 150
  def test_return_to_vendor_when_out_conflicts(self): ...
  def test_sell_needs_buyer_and_makes_delivery_note(self):
      res = sell(roll, buyer=BUYER, savio_bill_no=None)
      self.assertEqual(res["roll"]["status"], "SOLD")
      dn = frappe.get_doc(res["movement"]["stock_doctype"], res["movement"]["stock_docname"])
      self.assertEqual((dn.doctype, dn.customer, dn.items[0].qty), ("Delivery Note", BUYER, 150))
  def test_sell_rate_per_roll_sets_amount(self):
      res = sell(roll, buyer=BUYER, rate_per_roll=3000)
      dn = frappe.get_doc("Delivery Note", res["movement"]["stock_docname"])
      self.assertAlmostEqual(dn.items[0].amount, 3000)
  def test_sold_roll_rejects_out(self):  # "This roll has already been sold"
  def test_in_cannot_exceed_original(self): ...
  def test_adjustment_to_zero_consumes(self): ...
  def test_operator_date_rule_applies(self): ...
  def test_same_client_id_returns_first_movement(self): ...
  def test_more_than_four_photos_rejected(self): ...
  ```
- [ ] **Step 3: Run both, expect FAIL**
- [ ] **Step 4: Implement** `dates.py`, then `record_movement` dispatching to one private
  function per type; each writes the ERPNext document (submitted, `ignore_permissions`,
  `allow_zero_valuation_rate=1`) and the Roll Movement in the same transaction and updates
  the Batch's `rt_status`, `rt_remaining_weight`, `rt_location`. Rate per roll → line rate =
  rate ÷ qty (a hook in `stock_docs`).
- [ ] **Step 5: Run, expect PASS**
- [ ] **Step 6: Commit** `feat(erpnext): movement engine on ERPNext stock documents`

---

### Task 7: Ledger agreement check and stock summary

**Files:**
- Create: `royal_touche/checks.py`
- Test: `royal_touche/tests/test_checks.py`

**Interfaces:**
- Produces: `royal_touche.checks.ledger_mismatches(batches: list[str] | None = None) -> list[dict]`
  (each `{"roll", "expected_kg", "ledger_kg"}`; expected = `rt_remaining_weight` for live
  IN_STOCK/ISSUED rolls, 0 for finished or deleted ones; ledger = sum of Stock Ledger Entry
  `actual_qty` for the batch, non-cancelled);
  `royal_touche.checks.stock_summary() -> list[dict]` (per material: `material`,
  `on_hand_kg` = sum of remaining weight of live IN_STOCK rolls, `rolls_in_stock`).

- [ ] **Step 1: Failing tests** — after a scripted lifecycle (register 3 rolls; OUT, RETURN 80,
  CONSUME, RETURN_TO_VENDOR, SELL, ADJUSTMENT) `ledger_mismatches()` is `[]`; after directly
  setting one Batch's `rt_remaining_weight` to a wrong value, it returns exactly that roll;
  **late offline case:** record a movement dated yesterday after newer movements on other
  rolls, then `ledger_mismatches()` is still `[]`; `stock_summary()` gives the hand-computed
  totals for the lifecycle.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): ledger agreement check and stock summary`

---

### Task 8: Roll edit, remark flags, delete

**Files:**
- Modify: `royal_touche/rolls.py`
- Test: `royal_touche/tests/test_roll_edit_delete.py`

**Interfaces:**
- Produces: `royal_touche.rolls.update_roll(name: str, changes: dict) -> dict` (allowed:
  roll_number, barcode, paper fields, gsm, width, lot; location never: it only changes
  through movements); `royal_touche.rolls.set_remark_codes(name: str, codes: list[str]) -> dict`;
  `royal_touche.rolls.delete_roll(name: str) -> dict` returning `{"name", "deleted": True}`.

- [ ] **Step 1: Failing tests** — `update_roll` rejects `status` with
  `A roll's status follows its movements — issue or consume it instead`, rejects
  `client_id` change with `client_id is set when the roll is created and cannot be changed`,
  rejects `remaining_weight`; renaming to a taken roll number → `RTDuplicate`;
  `set_remark_codes` with an unknown code → `One or more remarks don't exist`, more than 20 →
  `Too many remark codes`; **delete a roll with OUT + RETURN + SELL history** → all its stock
  documents cancelled newest first, batch stock 0 everywhere, Batch `rt_deleted=1`,
  `rt_roll_key` NULL (the number can be reused), every Roll Movement `deleted=1`, and
  `frappe.get_all("Batch", {"modified": [">=", before]}, ["name","rt_deleted"])` includes it.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): roll edit, remark flags and delete`

---

### Task 9: Sync batch

**Files:**
- Create: `royal_touche/sync.py`, doctype `sync_log` (user, ip, item_count, applied, failed,
  skipped, duration_ms, request_body JSON, results JSON; autoname hash)
- Test: `royal_touche/tests/test_sync.py`

**Interfaces:**
- Consumes: `register_roll`, `record_movement`, lot/vendor/paper creation (Tasks 3–6).
- Produces: `royal_touche.sync.run_batch(items: list[dict]) -> dict` →
  `{"results": [{"index", "type", "client_id", "status", "data"?, "error"?, "code"?, "reason"?}]}`.
  Item types: `lot`, `vendor`, `supplier_code`, `roll`, `movement`. A movement may carry
  `roll_client_id` instead of `roll`.

Rules: port `backend/src/services/sync.service.ts` — masters first, then the rest in queue
order; each item in its own savepoint so one failure does not roll back the others; a failed
roll makes its later movements `skipped` / `dependency_failed`, and a failed movement makes
later movements on the same roll skipped; one Sync Log per call.

- [ ] **Step 1: Failing tests**

  ```python
  def test_roll_and_its_movement_in_one_batch(self):
      res = run_batch([roll_item(cid=A), movement_item(cid=B, roll_client_id=A, type="OUT", location=RUNNING_1)])
      self.assertEqual([r["status"] for r in res["results"]], ["ok", "ok"])
  def test_replaying_a_half_applied_batch(self):
      first = run_batch([roll_item(cid=A), roll_item(cid=C, roll_number="BAD", lot=None)])
      again = run_batch([roll_item(cid=A), roll_item(cid=C, roll_number="BAD2")])
      self.assertEqual(again["results"][0]["data"]["name"], first["results"][0]["data"]["name"])
      self.assertEqual(frappe.db.count("Batch", {"rt_client_id": A}), 1)
  def test_failed_roll_skips_its_movements_only(self): ...   # unrelated item still "ok"
  def test_reasons(self): ...  # duplicate roll number → "duplicate"; OUT twice → "conflict"; bad field → "validation"
  def test_limits(self):       # 51 items → "A batch cannot exceed 50 items — send the rest in the next call"
                               # repeated client_id → "Every item needs its own client_id"
  def test_writes_a_sync_log(self): ...
  ```
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): offline sync batch with replay and dependency skips`

---

### Task 10: Permissions, delta reads, whitelisted API

**Files:**
- Create: `royal_touche/api/{auth,rolls,movements,sync,stock,app}.py`,
  `royal_touche/fixtures/custom_docperm.json`
- Modify: `hooks.py` (fixtures for permissions; `index` on `modified` where the doctype
  lacks one)
- Test: `royal_touche/tests/test_api_permissions.py`

**Interfaces:**
- Produces (all `@frappe.whitelist(methods=[...])`):
  `royal_touche.api.auth.me() -> {"user", "full_name", "role"}` (role = the RT role, one of
  `super_admin`, `admin`, `godown_supervisor`, `godown_operator`);
  `royal_touche.api.rolls.register(**data)`, `.update(name, **changes)`,
  `.set_remark_codes(name, codes)`, `.delete(name)`, `.find(code)`;
  `royal_touche.api.movements.record(**data)`; `royal_touche.api.sync.batch(items)`;
  `royal_touche.api.stock.summary()`; `royal_touche.api.app.apk_url()` (reads site config
  key `rt_apk_url`). Errors from `royal_touche.errors` reach the client with their
  `http_status_code` and `reason`.

Permission matrix (from today's `requireRole` / `requireGodownWrite` / `canWrite` /
`canManage` in `backend/src/routes`): godown roles read masters, lots, rolls, movements and
may call register / record / sync / set_remark_codes; only RT Admin and RT Super Admin edit
masters, delete rolls and manage users; reports for Godown Supervisor and up.

- [ ] **Step 1: Failing tests**

  ```python
  def test_operator_cannot_post_stock_entry_directly(self):
      with as_user(OPERATOR), self.assertRaises(frappe.PermissionError):
          frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Issue", ...}).insert()
  def test_operator_can_register_through_api(self): ...
  def test_operator_cannot_read_rate_per_roll(self):
      with as_user(OPERATOR):
          row = frappe.get_list("Roll Movement", fields=["name", "rate_per_roll"], limit=1)
      self.assertNotIn("rate_per_roll", row[0])
  def test_operator_cannot_delete_roll(self): ...
  def test_me_returns_rt_role(self): ...
  def test_delta_read_returns_disabled_and_deleted_in_modified_order(self):
      rows = frappe.get_list("RT Remark", filters={"modified": [">=", since]}, fields=["name", "disabled", "modified"],
                             order_by="modified asc, name asc")
      self.assertIn(disabled_remark, [r.name for r in rows])
  def test_rt_errors_carry_status_and_reason(self): ...
  ```
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** wrappers (no logic; call Tasks 5–9), permissions as fixtures.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(erpnext): API methods, role permissions, delta reads`

---

### Task 11: Reports with parity against today's numbers

**Files:**
- Create: `backend/src/utils/exportSeedScenario.ts` (+ `package.json` script
  `"seed:export": "tsx src/utils/exportSeedScenario.ts"`),
  `erpnext/royal_touche/royal_touche/tests/fixtures/october.json`, `.../september.json`,
  `royal_touche/royal_touche/report/consumption/consumption.{json,py}`,
  `royal_touche/royal_touche/report/daily_roll_status/daily_roll_status.{json,py}`,
  `royal_touche/tests/replay_scenario.py`
- Test: `royal_touche/tests/test_reports.py`

**Interfaces:**
- Produces: `consumption.execute(filters) -> (columns, data)` with filters `from_date`,
  `to_date`, `group` (`material` | `design`); `royal_touche.reports.consumption_summary(from_date, to_date, group) -> dict`
  and `consumption_detail(from_date, to_date, group) -> list[dict]` (port of
  `consumptionReport.service.ts`, reading Roll Movement in write order `creation, name`,
  IST days); `daily_roll_status.execute(filters) -> (columns, data)` with the 30 columns of
  `dailyRollReport.service.ts` `REPORT_COLUMNS`, in that order;
  `royal_touche.tests.replay_scenario.load(path) -> None` (creates the scenario's masters,
  lots, rolls and movements through `register_roll` / `record_movement`, stamping each
  record's `creation` to the scenario time).

- [ ] **Step 1: Write `exportSeedScenario.ts`** — imports the `ROLLS`, `MOVEMENTS`, `LOTS`,
  `MATERIALS`, `EXPECTED`, `OCTOBER_BY_ROLL`, `DAILY` constants and `bulkPlan()` /
  `computeBulkTally()` from `seedMonth.ts` (export them there; no behaviour change) and writes
  the two JSON fixtures. No database access.
- [ ] **Step 2: Run it**

  Run: `cd backend && npm run seed:export`
  Expected: both JSON files written; `october.json` has 15 rolls and 31 movements, `september.json` 200 rolls and 353 movements.
- [ ] **Step 3: Failing tests**

  ```python
  def test_october_figures_match(self):
      load(FIXTURES / "october.json")
      for case in OCTOBER["expected"]:
          got = consumption_summary(case["from"], case["to"], "material")
          for material, figures in case["figures"].items():
              self.assertEqual(row_figures(got, material), figures, case["label"])
  def test_october_by_roll(self): ...          # OCTOBER_BY_ROLL against consumption_detail
  def test_reconcile_identity_every_row(self): # opening + received − consumed − rtv − sold ± adjusted == closing
  def test_september_bulk_tally(self): ...     # computeBulkTally figures, by material and by design
  def test_daily_roll_status_checks(self): ... # every DAILY entry
  def test_daily_columns_in_order(self):
      self.assertEqual([c["fieldname"] for c in execute({"date": "2026-10-15"})[0]], NODE_COLUMNS)
  ```
- [ ] **Step 4: Run, expect FAIL**
- [ ] **Step 5: Implement** (port the two services; Script Reports call them).
- [ ] **Step 6: Run, expect PASS** — then also run the whole suite:

  Run: `cd ~/frappe-bench && bench --site rt-test.localhost run-tests --app royal_touche`
  Expected: all tests pass, `ledger_mismatches()` is `[]` after both scenarios.
- [ ] **Step 7: Commit** `feat(erpnext): consumption and daily status reports with parity tests`

---

## Self-review notes

- Spec coverage: §5 A1–A3 → Tasks 2, 10 (user management via standard User REST, roles);
  B4–B8 → Task 3; C9–C10 → Task 4; C11 → Task 5; C12 → Task 8; C13 photos → Attach fields
  here, GCS storage in Plan 4; D14–D21 → Tasks 6, 7; E22 → Task 9; E23–E24 → Task 10 (delta
  via standard REST; no photo URLs in list reads); F25–F26 → Task 11; G27 → Task 10;
  §7 price → Tasks 5, 6, 10; §9 OAuth client → Plan 4 (local tests use session/`as_user`).
- Out of this plan by design: app and portal changes (Plans 2, 3), servers, GCS, prod import,
  cut-over (Plan 4).
