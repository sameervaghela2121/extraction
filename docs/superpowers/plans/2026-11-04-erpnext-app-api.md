# ERPNext Backend — Plan 2 of 4: Tablet app on ERPNext

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Android app (flavour `erp`) logs in, syncs, registers rolls, records every movement
and works offline against the ERPNext backend, through the laptop's ngrok tunnel.

**Architecture:** Screens, the local Room database, the outbox and the sync loop stay. What
changes is the edge: a new Retrofit interface and DTOs for ERPNext, mappers from those DTOs into
the existing Room entities, the outbox's batch payload, login/refresh, photo upload, and a buyer
picker in the sell dialog. The backend gains login tokens, one delta-pull endpoint and a dev
seed, all in `royal_touche`.

**Tech Stack:** Kotlin, Retrofit + Moshi + OkHttp, Room (minSdk 24), Coil 2; ERPNext 16 +
`royal_touche` (Python), ngrok.

**Spec:** `docs/superpowers/specs/2026-11-03-erpnext-backend-design.md` (§4, §5 A/E, §8, §9)

**Repos and branches:** backend `extraction/` on `feature/erpnext-backend` (Tasks 1–3); app
`royal-touche-fe/` on `feature/erpnext` (Tasks 4–10). The user pushes the app branch (GitLab
has no credentials on this machine).

## Global Constraints

- Everything users see is named **Royale Touche**. "ERP" appears only in the flavour name and
  the application id suffix `.erp` (spec decision 2026-11-04).
- On this branch every flavour speaks the ERPNext API. Only `erp` has a working server until
  cut-over (Plan 4), when `prod` is pointed at the production ERPNext.
- The `erp` server address comes from `local.properties` `erp.baseUrl` (ends with `/api/`).
- Login (user's choice, Option B): users are ERPNext Users; ERPNext checks the password; our
  login endpoint returns an access token (**3600 s**) and a refresh token stored as ERPNext
  **OAuth Bearer Token** records, so ERPNext's own code authenticates every request. Refresh
  tokens live **30 days from last use**; logout revokes the token; a disabled user can't refresh.
- Room: every schema change gets a migration (no RENAME/DROP COLUMN on minSdk 24); screens keep
  reading only Room.
- Logs: one line per call, never bodies (existing `ApiLoggingInterceptor`).
- Device tests: the user does every tap; the executor only watches logs, screenshots and the DB.
- Out of scope: label OCR (`ocr/roll-label-ai`, an AI module); portal (Plan 3); servers (Plan 4).

## Review Focus

1. **A tablet offline longer than the access token** → on reconnect the refresh happens quietly
   and the outbox drains; after 30 days unused, the login screen appears and the outbox is kept.
   Pinned in Task 4.
2. **Local data left from the Node backend** (same package at cut-over, or ids from before) →
   wiped on first start against the new backend, but never while the outbox holds unsent work.
   Pinned in Task 5.
3. **The ngrok address changes or the laptop sleeps** → network error shown, outbox kept, no
   crash; sync resumes when the server is back. Pinned in Task 4.
4. **An ERPNext error carrying HTML** (`<strong>`, links) → plain readable text on screen and in
   the outbox issue list. Pinned in Task 4.
5. **A photo upload retried after a timeout** → the movement is recorded once; an orphan file is
   acceptable. Pinned in Task 8.

---

## Contract between app and backend

| Need | Call | Shape |
|---|---|---|
| Login | `POST method/royal_touche.api.auth.login` `{usr, pwd}` | `{"message": {access_token, refresh_token, expires_in, user, full_name, role}}` |
| Refresh | `POST method/royal_touche.api.auth.refresh` `{refresh_token}` | same as login |
| Logout | `POST method/royal_touche.api.auth.logout` | `{"message": "ok"}` |
| Who am I | `GET method/royal_touche.api.auth.me` | `{"message": {user, full_name, role}}` |
| Delta pull | `GET method/royal_touche.api.pull.changes?kind=&after=&after_name=&limit=` | `{"message": {items: [...], next: {after, after_name} \| null}}` |
| Sync batch | `POST method/royal_touche.api.sync.batch` `{items}` | `{"message": {results: [...]}}` |
| Find roll | `GET method/royal_touche.api.rolls.find?code=` | `{"message": roll}` |
| One lot | `GET resource/Roll Lot/{name}` | `{"data": lot}` |
| Upload photo | `POST method/upload_file` (multipart `file`, `is_private=1`) | `{"message": {file_url}}` |
| Photo bytes | `GET {server}{file_url}` with the bearer header | image |

`kind` is one of `materials`, `vendors`, `locations`, `remarks`, `buyers`, `lots`, `rolls`,
`movements`. Errors: Frappe's JSON (`exc_type`, `_server_messages`, `message`) with the HTTP status
our `RTError` classes set.

**Ruling (spec §4 says "standard REST filtered `modified >= checkpoint`"):** delta pulls use one
custom endpoint. Standard REST can't express keyset paging on `(modified, name)` (Frappe filters
can't OR an AND), and vendors and rolls need joined data (papers, lot, remark codes). Ad-hoc reads
(one lot) stay on standard REST.

---

### Task 1 (backend): Login tokens

**Files:**
- Modify: `erpnext/royal_touche/royal_touche/api/auth.py`, `setup/install.py`
- Test: `erpnext/royal_touche/royal_touche/tests/test_auth.py`

**Interfaces:**
- Produces: whitelisted `login(usr, pwd)`, `refresh(refresh_token)` (both `allow_guest=True`,
  POST), `logout()`, existing `me()`; constant `APP_CLIENT = "Royal Touche App"` (an OAuth Client
  created idempotently by `ensure_setup`); `ACCESS_SECONDS = 3600`, `REFRESH_DAYS = 30`.

- [ ] **Step 1: Failing tests** — login with the right password returns both tokens and
  `role == "godown_operator"`; a request with `Authorization: Bearer <access>` to
  `royal_touche.api.auth.me` (through `frappe.auth.validate_oauth`) acts as that user; wrong password →
  `frappe.AuthenticationError` with message `Invalid login credentials`, nothing created; disabled
  user → same error; refresh returns a new pair and revokes the old access token; refresh with a
  revoked, expired (31 days unused) or unknown token → `frappe.AuthenticationError`; a disabled
  user's refresh fails; logout revokes the caller's tokens; a user without an RT role can't log in
  (`You do not have access to the Royale Touche app`).
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** — password check with `frappe.utils.password.check_password`; tokens
  `frappe.generate_hash(length=40)`; OAuth Bearer Token fields `client=APP_CLIENT`, `user`,
  `scopes="all"`, `expires_in=ACCESS_SECONDS`, `expiration_time`, `status="Active"`; refresh
  lifetime tracked by the record's `modified` (bumped on each refresh). Login attempts go through
  Frappe's login rate limit (`frappe.rate_limiter` on the method: 10 per 5 minutes per IP).
- [ ] **Step 4: Run, expect PASS**; then the whole suite.
- [ ] **Step 5: Commit** `feat(erpnext): app login with ERPNext-checked access and refresh tokens`

---

### Task 2 (backend): Delta pull endpoint

**Files:**
- Create: `erpnext/royal_touche/royal_touche/api/pull.py`, `royal_touche/pull.py`
- Test: `erpnext/royal_touche/royal_touche/tests/test_pull.py`

**Interfaces:**
- Consumes: `rolls.roll_dict`, `movements.movement_dict`, `masters.vendor_dict`, `lots.lot_dict`,
  `api._access.without_prices`.
- Produces: `royal_touche.pull.changes(kind: str, after: str | None, after_name: str | None,
  limit: int = 200) -> dict` (`items`, `next`); item shapes:
  - materials: `name, material_code, item_name, disabled, sort_order, modified`
  - vendors: `vendor_dict` + `disabled`
  - locations: `name, location_code, warehouse_name, godown, sort_order, disabled, modified`
  - remarks: `name, remark_code, label, sort_order, disabled, modified`
  - buyers: `name, customer_name, disabled, modified`
  - lots: `lot_dict`
  - rolls: `roll_dict` + `lot_document_type`, `lot_document_no` (no photo links)
  - movements: `movement_dict` without prices, plus `roll_number`
  Order is `modified asc, name asc`; keyset `(modified, name) > (after, after_name)`; `next` is the
  last row's pair, or `null` when fewer than `limit` came back. `limit` capped at 500.

- [ ] **Step 1: Failing tests** — for each kind: a record changed after the checkpoint comes back,
  one before doesn't; two records sharing one `modified` across a page boundary both arrive exactly
  once (limit 1); disabled/deleted records come back flagged; an unknown kind → `RTValidation`;
  movements never carry `rate_per_roll` for a godown user; materials leave out non-RT Items (no
  `rt_material_code`); locations leave out group warehouses and other companies'.
- [ ] **Step 2–4: RED, implement, GREEN** (whole suite after).
- [ ] **Step 5: Commit** `feat(erpnext): one keyset delta pull for every synced record kind`

---

### Task 3 (backend): Dev seed

**Files:**
- Create: `erpnext/royal_touche/royal_touche/setup/dev_seed.py`
- Test: `erpnext/royal_touche/royal_touche/tests/test_dev_seed.py`

**Interfaces:**
- Produces: `dev_seed.load(repo_docs: str) -> dict` (counts), run as
  `bench --site rt.localhost execute royal_touche.setup.dev_seed.load --kwargs "{'repo_docs': '<repo>/docs'}"`.
  Reads `vendors-seed.json`, `locations-seed.json`, `remarks-seed.json`; creates materials
  `BASE-PAPER`, `TISSUE`, `BARRIER`, one buyer `Walk-in Buyer`, and one user per RT role
  (`rt-operator@rt.localhost`, `rt-supervisor@rt.localhost`, `rt-admin@rt.localhost`,
  `rt-superadmin@rt.localhost`) with a password written to `~/.config/rt-erpnext/dev-users`
  (mode 600). Refuses to run unless `developer_mode` is on.

- [ ] **Step 1: Failing tests** — loading twice gives the same counts and no duplicates; vendor
  papers carry their RT/Delta codes; refuses when `developer_mode` is off.
- [ ] **Step 2–4: RED, implement, GREEN.**
- [ ] **Step 5: Run it on `rt.localhost`** and confirm counts match the JSON files (74 vendors,
  6 locations, the remarks file's count).
- [ ] **Step 6: Commit** `feat(erpnext): dev seed of masters and one user per role`

---

### Task 4 (app): Network layer, login and errors

**Files:**
- Create: `data/api/ErpApi.kt`, `data/api/dto/ErpDtos.kt`, `data/api/FrappeErrors.kt`
- Modify: `data/api/NetworkModule.kt`, `AuthInterceptor.kt`, `TokenAuthenticator.kt`,
  `ApiErrorParser.kt`, `data/auth/AuthRepository.kt`, `app/build.gradle.kts` +
  `gradle/libs.versions.toml` (testImplementation `com.squareup.okhttp3:mockwebserver`, same
  version as okhttp)
- Delete: `data/api/RoyalTouchApi.kt` once Tasks 4–8 no longer use it (end of Task 8)
- Test: `app/src/test/.../data/api/ErpAuthTest.kt`, `FrappeErrorsTest.kt`

**Interfaces:**
- Produces: `interface ErpApi` with the contract table's calls (Retrofit paths relative to
  `BASE_URL`, e.g. `@POST("method/royal_touche.api.auth.login")`); `data class FrappeMessage<T>(val
  message: T)`, `FrappeData<T>(val data: T)`; `FrappeErrors.userMessage(code: Int, body: String?):
  String` (reads `_server_messages` → `message` → `exception`, strips HTML tags and entities, falls
  back to today's per-status texts); `AuthRepository.login/refreshRole/logout` unchanged signatures.

- [ ] **Step 1: Failing tests (MockWebServer)** — login stores both tokens and the role; a 401
  triggers exactly one refresh, the request is retried with the new token, and the new refresh token
  replaces the old; a failed refresh clears the session (login screen) but the outbox table is
  untouched; parallel 401s refresh once; `FrappeErrors` turns
  `{"_server_messages":"[\"{\\\"message\\\": \\\"Cannot enable <strong>Has Batch No</strong>\\\"}\"]"}`
  into `Cannot enable Has Batch No`; an unreachable host gives `Network error. Check your connection
  and try again.`
- [ ] **Step 2–4: RED, implement, GREEN** (`./gradlew :app:testErpDebugUnitTest`).
- [ ] **Step 5: Commit** `feat: ERPNext network layer, token login and readable errors`

---

### Task 5 (app): Server ids and the backend switch

**Files:**
- Modify: `data/local/ServerIds.kt`, the 47 call sites in `data/sync/SyncManager.kt` and
  `data/repository/LocalRollRepository.kt`, `data/SessionStore.kt`, `data/AppRepositories.kt`
- Test: `app/src/test/.../data/local/ServerIdsTest.kt`, `BackendSwitchTest.kt`

**Interfaces:**
- Produces: `ServerIds.isServerId(id: String?): Boolean` (true unless blank, `local-…`,
  `cl-…`, `fake-…`, `scanned-…` or a UUID); `isObjectId`/`requireObjectId` removed;
  `BACKEND_GENERATION = "erpnext-1"`; `BackendSwitch.decide(stored: String?, outboxCount: Int):
  Decision` (`KEEP`, `WIPE`, `WAIT_FOR_OUTBOX`).

- [ ] **Step 1: Failing tests** — ERPNext names (`3f9a1c22be`, `Vendor ABC`, `TISSUE`,
  `Godown A side 1 - RT`) are server ids; `local-12`, a UUID, `cl-1a2b3c4d` are not; `decide(null, 0)
  == WIPE`, `decide("erpnext-1", 5) == KEEP`, `decide("node", 3) == WAIT_FOR_OUTBOX`,
  `decide("node", 0) == WIPE`.
- [ ] **Step 2–4: RED, implement, GREEN.** On `WIPE`: clear server-sourced tables, checkpoints and
  `last_sync_at`, keep the session, store the generation. On `WAIT_FOR_OUTBOX`: show the existing
  sync-issue banner text `Finish sending your saved work before this update can continue` and do
  nothing else.
- [ ] **Step 5: Commit** `feat: ERPNext ids, and a one-time local reset when the backend changes`

---

### Task 6 (app): Pulling data

**Files:**
- Create: `data/api/ErpMappers.kt`, Room `BuyerEntity` + `BuyerDao`
- Modify: `data/sync/SyncManager.kt` (refreshMaterials/Vendors/Locations/Remarks, new
  refreshBuyers, pullLots, refreshAllMaterialRollsFromServer, pullMovementsDelta, removeDeletedRoll),
  `data/local/RtDatabase.kt` (version 18, `MIGRATION_17_18` creates `buyers`)
- Test: `app/src/test/.../data/api/ErpMappersTest.kt` with JSON fixtures in
  `app/src/test/resources/erp/*.json`. The 17→18 migration (one new table, nothing altered) is
  proven on the tablet in Task 10: install the previous `erpDebug` build, sync, then install this
  one; the app opens with its data and buyers appear.

**Interfaces:**
- Consumes: `ErpApi.changes(kind, after, afterName, limit)`.
- Produces: one generic `suspend fun pullKind(kind: String, checkpointKey: String, apply: suspend
  (List<JSONObject>) -> Unit)`; mappers `fun materialEntity(json: JSONObject): RawMaterialEntity`
  and likewise vendor (+ `PaperCodeEntity` list), location, remark, buyer, lot, roll, movement;
  checkpoint keys stay as today, value = `"<after>|<after_name>"`.

- [ ] **Step 1: Capture fixtures** — call each `kind` on `rt.localhost` after Task 3's seed and a
  registered + moved + sold roll; save one response per kind into `app/src/test/resources/erp/`.
- [ ] **Step 2: Failing tests** — each mapper fills every field the Room entity has today (roll:
  status, remaining weight, location, paper codes, lot type/number, remark codes, deleted); a
  disabled master maps to `status = "inactive"`; a deleted roll is recognised as removed.
- [ ] **Step 3–5: RED, implement, GREEN; commit** `feat: pull every record kind from ERPNext`

---

### Task 7 (app): Sending the outbox

**Files:**
- Create: `data/sync/ErpBatchPayload.kt`
- Modify: `data/sync/SyncManager.kt` (`buildBatchItem`, `movementEnvelope`, `postBatchChunk`,
  `applyBatchSuccess`, `rewriteRollIds`), `data/repository/LocalRollRepository.kt` (the payloads at
  lines ~280–360, ~640–680, ~800, ~900, ~1210–1305), `LotRepository.kt`
- Test: `app/src/test/.../data/sync/ErpBatchPayloadTest.kt`, `BatchResultTest.kt`

**Interfaces:**
- Produces: `ErpBatchPayload.roll(payload: JSONObject): JSONObject`, `.movement(...)`, `.lot(...)`,
  `.vendor(...)`, `.supplierCode(...)` translating today's stored outbox payloads (so queued work
  from before the update still sends) into the backend's field names:
  `material_id→material`, `vendor_id→vendor`, `lot_id/lot_server_id→lot`,
  `papers[0].royal_touche_code→rt_code`, `papers[0].delta_code→delta_code`,
  `transaction_type→movement_type`, `roll_id→roll`, `photo_paths→photos`,
  `tag_photo_path→tag_photo`, `stitched_barcode_photo_path→barcode_photo`, `is_consumed: true` →
  `movement_type: "RETURN", returned_weight: 0` (OUT-time consumption) or `"CONSUME"`, `date` and
  `transaction_date` sent as the device's local time with its zone offset;
  `BatchResult.of(json): BatchResult(status, reason, error, data)`.
- Behaviour: `ok` → apply; `skipped` (`dependency_failed`) → leave pending, as today's "not
  attempted"; `failed` with `duplicate` → today's ignoreDuplicate; other `failed` → mark failed with
  the plain-text error. `resume_from` is gone: an item with no result is left pending.

- [ ] **Step 1: Failing tests** — each translator on a real stored payload (copied from today's
  outbox format) gives exactly the backend's keys and drops the rest; zoned dates keep their offset;
  results for ok / failed / skipped / missing map to apply / fail / pending / pending.
- [ ] **Step 2–4: RED, implement, GREEN; Step 5: commit** `feat: send the outbox to ERPNext's sync batch`

---

### Task 8 (app): Photos

**Files:**
- Modify: `data/media/MediaUploader.kt`, `RtApp.kt` (Coil `ImageLoader` OkHttp client),
  `data/sync/SyncManager.kt` (`uploadMovementPhotos`, `prepareRollPhotos`)
- Test: `app/src/test/.../data/media/PhotoAuthTest.kt`

**Interfaces:**
- Produces: upload returns the `file_url` (`/private/files/…`); `AuthOnOwnHost` OkHttp interceptor
  adds the bearer header only when the request host equals `BASE_URL`'s host; photo URLs shown in
  the app are `BASE_URL`'s origin + `file_url`.

- [ ] **Step 1: Failing tests** — the header is added for the server's host and never for any
  other host; a relative `file_url` becomes an absolute URL on the server's origin; an upload that
  times out and is retried still produces one movement (the outbox item keeps its `client_id`).
- [ ] **Step 2–4: RED, implement, GREEN.** Delete `RoyalTouchApi.kt` and its last uses.
- [ ] **Step 5: Commit** `feat: photos through ERPNext's file upload, shown with the app's token`

---

### Task 9 (app): Selling to a buyer

**Files:**
- Modify: `ui/roll/RollActionsController.kt` (state `selectedBuyer`, `savioBillNo`, `vehicleNo`),
  the sell dialog in `ui/roll/RollDetailsContent.kt` / `ui/scan/ScanResultScreen.kt`,
  `data/repository/LocalRollRepository.kt` (sell payload), strings EN/HI/GU
- Test: `app/src/test/.../ui/roll/SellDialogTest.kt`

**Interfaces:**
- Consumes: `BuyerDao.observeActive()` (Task 6).
- Produces: sell payload adds `buyer` (required), `savio_bill_no`, `vehicle_no` (optional); the
  photo becomes optional (spec §8).

- [ ] **Step 1: Failing tests** — confirm is disabled until a buyer is picked; bill no. and vehicle
  no. are optional and trimmed; vehicle no. upper-cased; the queued payload carries the three
  fields; no photo is required.
- [ ] **Step 2–4: RED, implement, GREEN.** Strings: `sell_buyer_label` "Buyer",
  `sell_buyer_required` "Pick the buyer", `sell_bill_label` "Savio bill no. (optional)",
  `sell_vehicle_label` "Vehicle no. (optional)", with Hindi and Gujarati.
- [ ] **Step 5: Commit** `feat: sell to a picked buyer with optional bill and vehicle numbers`

---

### Task 10: On the tablet, end to end

**Files:** none (verification); notes go in the ledger.

- [ ] **Step 1:** `bench start`; `ngrok http 8000 --host-header=rt.localhost`; put the tunnel in
  `local.properties`; build `erpDebug`; the user installs it.
- [ ] **Step 2: The user, step by step; the executor watches logs and the server:**
  1. Log in as `rt-operator@rt.localhost` → first sync shows 74 vendors, 6 locations, 3 materials.
  2. Create a lot, register a roll with a scale weight.
  3. OUT to Running Godown side 1; RETURN 80 kg; SELL to `Walk-in Buyer` with a bill no.
  4. Airplane mode: register a roll and move it; back online: it drains once.
  5. Log out; log in as `rt-supervisor@rt.localhost`; the sold roll shows in Inventory.
- [ ] **Step 3:** `bench --site rt.localhost execute royal_touche.checks.ledger_mismatches` → `[]`;
  the movements in Desk match what the tablet showed.
- [ ] **Step 4:** Record anything the user saw as wrong; fix through the task that owns it.

---

## Self-review notes

- Spec §8 app items → Tasks 4–9; §9 login → Task 1 + 4 (the user chose stored tokens, Option B);
  §5 E22–E24 → Tasks 2, 6, 7; buyers (§5 B8) → Tasks 2, 6, 9.
- Plan 1 deferred items for the app: sync response fields (Task 7 drops `resume_from` handling);
  HTML in errors (Task 4); `transaction_type` wording and `is_consumed` (Task 7 translates).
- Open for the user: label OCR has no ERPNext endpoint, so the "read label" button will fail
  with "OCR failed — check your network connection." until it is decided (out of scope).
