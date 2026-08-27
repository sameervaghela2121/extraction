# Offline Sync — Mobile SQLite Spec

For the Royal Touch mobile app. Describes the local SQLite database, how queued writes
reach the server, and the rules the app must follow for the server-side guarantees to
hold.

**There are no sync endpoints.** Offline writes replay against the ordinary API routes —
`POST /material-rolls`, `POST /stock/movements`. The only additions are two request fields the
server now understands: `client_id` (makes a write idempotent) and `updated_after`
(fetches only what changed).

---

## 1. The idea in one paragraph

The phone never writes to the server directly. It writes to its own SQLite database and
appends a row to an **outbox** table. When there is signal, a background worker drains the
outbox oldest-first, one item at a time, hitting the same endpoints the online app uses.
Every queued item carries a UUID the phone minted — `client_id`. If a request succeeds but
the response is lost, the phone re-sends it; the server recognises the `client_id` and
returns what it stored the first time instead of doing the work twice.

That last sentence is the whole safety property. **A movement applied twice silently
inflates the stock figure and nobody notices.**

---

## 2. Schema

Six tables. Copy this as-is.

```sql
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Reference data. Read-only on the device: refreshed wholesale from the server,
-- never edited here, never queued. Small enough that a full refetch beats a delta.
-- ---------------------------------------------------------------------------
CREATE TABLE raw_materials (
  id             TEXT PRIMARY KEY,        -- server ObjectId, 24 hex chars
  material_code  TEXT NOT NULL,
  name           TEXT NOT NULL,
  category       TEXT,
  unit           TEXT NOT NULL,
  gsm            REAL,
  width_mm       REAL,
  status         TEXT NOT NULL            -- 'active' | 'inactive'
);

CREATE TABLE vendors (
  id           TEXT PRIMARY KEY,          -- server ObjectId
  vendor_code  TEXT NOT NULL,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL
);

-- The base papers a vendor supplies, from the Royal Touche paper-codes sheet. This is
-- what lets an operator fill in royal_touche_code with no signal: pick the supplier,
-- pick one of its papers. Arrives embedded in the vendor JSON; flattened here so the
-- picker can query it.
CREATE TABLE vendor_papers (
  vendor_id            TEXT NOT NULL REFERENCES vendors(id),
  royal_touche_code    TEXT NOT NULL,     -- goes onto the roll as-is, e.g. "639"
  delta_code           TEXT,
  is_common            INTEGER,
  supplier_code_number TEXT,              -- e.g. "AP 126640 SULAWEZI"
  found_in             TEXT,              -- "1.00mm" | "1.25mm" | "Delta" | a combination
  PRIMARY KEY (vendor_id, royal_touche_code)
);

-- The godown bays. Render in sort_order — it follows the physical walk through the
-- warehouse, and alphabetically "Running Godown" would land between the two Godowns.
CREATE TABLE locations (
  id             TEXT PRIMARY KEY,        -- server ObjectId
  location_code  TEXT NOT NULL,
  name           TEXT NOT NULL,           -- what a roll/movement stores, as a STRING
  godown         TEXT,                    -- groups the sides of one building
  sort_order     INTEGER,
  status         TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Mirrors of the server's collections. These hold BOTH rows pulled from the
-- server AND rows created offline that have not synced yet. A row created
-- offline has server_id NULL until its outbox item succeeds.
--
-- One table for both states, not two: the register screen then reads from one
-- place, and a roll does not visibly jump between lists when it syncs.
-- ---------------------------------------------------------------------------
CREATE TABLE material_rolls (
  local_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id          TEXT UNIQUE,         -- NULL until synced
  client_id          TEXT UNIQUE,         -- NULL for rows pulled from the server
  roll_number        TEXT NOT NULL,
  royal_touche_code  TEXT NOT NULL,       -- the base paper's RT code, off the label
  material_id        TEXT NOT NULL REFERENCES raw_materials(id),
  vendor_id          TEXT NOT NULL REFERENCES vendors(id),
  batch_no           TEXT,
  weight             REAL NOT NULL,
  remaining_weight   REAL,
  quantity           REAL,
  unit               TEXT,
  gsm                REAL NOT NULL,
  width              REAL NOT NULL,
  location           TEXT NOT NULL,
  date               TEXT NOT NULL,       -- ISO-8601
  status             TEXT,                -- IN_STOCK | OUT | CONSUMED ...
  tag_photo_path              TEXT,
  stitched_barcode_photo_path TEXT,
  side1_photo_path            TEXT,
  side2_photo_path            TEXT,
  sync_state         TEXT NOT NULL DEFAULT 'synced',  -- 'pending' | 'synced' | 'failed'
  updated_at         TEXT                 -- server updatedAt; NULL while pending
);

CREATE INDEX idx_rolls_sync   ON material_rolls(sync_state);
CREATE INDEX idx_rolls_number ON material_rolls(roll_number);

CREATE TABLE stock_transactions (
  local_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id          TEXT UNIQUE,
  client_id          TEXT UNIQUE,
  transaction_type   TEXT NOT NULL,       -- IN | OUT | RETURN | ADJUSTMENT
  transaction_date   TEXT NOT NULL,
  material_id        TEXT NOT NULL REFERENCES raw_materials(id),
  -- Points at the LOCAL roll row, not the server id: an OUT can be recorded
  -- against a roll registered minutes ago that has not synced yet.
  roll_local_id      INTEGER REFERENCES material_rolls(local_id),
  vendor_id          TEXT,
  weight             REAL,
  used_weight        REAL,
  new_weight         REAL,                -- ADJUSTMENT only
  returned_weight    REAL,                -- RETURN only
  from_location      TEXT,
  to_location        TEXT,
  location           TEXT,                -- OUT only: destination
  issued_to          TEXT,
  remarks            TEXT,
  roll_weight_after  REAL,
  description        TEXT,                -- server-rendered; NULL while pending
  sync_state         TEXT NOT NULL DEFAULT 'synced',
  updated_at         TEXT
);

CREATE INDEX idx_tx_sync ON stock_transactions(sync_state);
CREATE INDEX idx_tx_roll ON stock_transactions(roll_local_id);

-- ---------------------------------------------------------------------------
-- Photos captured offline. Its OWN queue, separate from the outbox, because
-- uploads are independent of each other and may run in parallel. See §5.
-- ---------------------------------------------------------------------------
CREATE TABLE pending_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_table  TEXT NOT NULL,             -- 'material_rolls' | 'stock_transactions'
  owner_local_id INTEGER NOT NULL,
  slot         TEXT,                      -- rolls: tag | stitched_barcode | side1 | side2
  file_path    TEXT NOT NULL,             -- ON-DEVICE path, for rendering before upload
  object_path  TEXT,                      -- server path after upload: "rolls/YYYY/MM/<uuid>.jpg"
  uploaded     INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_photos_pending ON pending_photos(uploaded, id);

-- ---------------------------------------------------------------------------
-- The outbox. One row per queued write, drained in local_id order.
-- ---------------------------------------------------------------------------
CREATE TABLE outbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,  -- also the FIFO order. See §4.
  client_id    TEXT NOT NULL UNIQUE,      -- UUID v4, minted once, NEVER regenerated
  method       TEXT NOT NULL,             -- 'POST' | 'PATCH'
  endpoint     TEXT NOT NULL,             -- '/material-rolls' | '/stock/movements'
  owner_table  TEXT NOT NULL,
  owner_local_id INTEGER NOT NULL,        -- the mirror row this will create/update
  payload      TEXT NOT NULL,             -- JSON body, WITHOUT ids resolved yet
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent' | 'failed'
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_outbox_pending ON outbox(status, id);

-- ---------------------------------------------------------------------------
-- Delta-pull checkpoints and anything else small. Key/value, not a column per
-- setting — this table will otherwise grow a column every sprint.
-- ---------------------------------------------------------------------------
CREATE TABLE sync_state (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
-- keys in use:
--   rolls_checkpoint       last updatedAt seen from GET /material-rolls
--   movements_checkpoint   last updatedAt seen from GET /stock/movements
--   reference_synced_at    last full refresh of raw_materials, vendors, locations
```

---

## 3. Pull — getting server changes onto the device

**Reference data (materials, vendors, locations)** — full refresh, no delta, no checkpoint:

```
GET /api/raw-materials
GET /api/vendors                  ← each vendor carries its papers[]
GET /api/locations?status=active
```

Call all three on login and on app foreground when online. Replace the local tables
wholesale. If a request fails, keep what is already there and carry on — a stale vendor
name is harmless because rolls reference the vendor by **id**, which never changes.

Two things ride along with these lists, and both are what make offline registration work:

- **`vendors[].papers[]`** carries `royal_touche_code`. Pick the supplier, pick one of its
  papers, and the roll's code fills itself in with no round trip.
- **`locations`** is the bay picker. Render in `sort_order`, group by `godown`, and pass
  `status=active` so closed bays are not offered. Rolls and movements store the location as
  a plain **string** — send `name`, never the id.

**Rolls and movements** — delta pull using the saved checkpoint:

```
GET /api/material-rolls?updated_after=<rolls_checkpoint>&pageSize=200
GET /api/stock/movements?updated_after=<movements_checkpoint>&pageSize=200
```

`updated_after` switches the server's sort to `updatedAt` ascending, so the backlog comes
back oldest-first and can be paged safely. Page until `items` is shorter than `pageSize`,
then save the **last row's `updatedAt`** as the new checkpoint. On the very first sync,
omit `updated_after` entirely to pull everything.

When an incoming row carries a `client_id` the device recognises, it is the server's copy
of something this phone queued: **update that local row in place** (fill in `server_id`,
`updated_at`, set `sync_state='synced'`) rather than inserting a
duplicate.

> **Known gap — deletions.** A roll deleted on the server will never appear in a delta
> pull, so the device keeps it forever. There is no tombstone endpoint yet. Until there
> is, a full refresh (drop the checkpoint, re-pull everything) is the only way to clear
> deleted rows. Raise this with the backend team before go-live.

---

## 4. Push — draining the outbox

```
while (online):
    item = SELECT * FROM outbox WHERE status='pending' ORDER BY id LIMIT 1
    if not item: break

    body = resolve_ids(item.payload)     # see below
    response = POST/PATCH  BASE + item.endpoint  with body + {client_id: item.client_id}

    if 2xx:
        write server id / updatedAt back to the mirror row
        mark mirror sync_state='synced', outbox status='sent'
        continue

    if 5xx or timeout or no network:
        attempts += 1; back off (2s, 4s, 8s … cap 5 min); RETRY THE SAME ITEM
        # same client_id. Never mint a new one.

    if 4xx:
        mark outbox status='failed', store last_error
        STOP THE LOOP and surface it to the user
```

**`resolve_ids`** — a queued movement references its roll by `roll_local_id`, because the
roll may not have existed on the server when the movement was recorded. Just before
sending, look up that local row's `server_id` and put it in the body as `roll_id`. Because
the queue drains in order, the roll's own outbox item has already succeeded and the id is
there. If it is NULL, that is a bug in the ordering — stop, do not send.

### Four rules that are not negotiable

1. **Strictly FIFO, strictly one at a time.** `remaining_weight` is derived by replaying
   movements in order. An OUT arriving before the roll that it belongs to fails outright;
   two movements racing each other can both read the same starting weight and one of them
   is then lost. Do not parallelise the flush, not even two at a time.

2. **Halt on the first 4xx — do not skip and continue.** A 4xx means the server rejected
   this item on its merits (validation, a real duplicate, a permission problem). Every
   later item in the queue may depend on it. Stop, show the user what failed, let them fix
   or discard it.

3. **One `client_id` per queued item, minted once, reused on every retry forever.** If a
   retry sends a fresh UUID the server sees a brand new write and applies it a second time.
   This is the single most important rule in this document.

4. **Retry 5xx and network failures indefinitely with backoff.** A lost response is
   indistinguishable from a lost request from the phone's side, and re-sending is safe
   precisely because of rule 3.

---

## 5. Things the phone cannot do offline

**`royal_touche_code` needs no server round trip.** It is Royal Touche's code for the base
paper (e.g. `639`), read off the label like `roll_number`, and the server stores what the
device sends. A roll registered offline has its real code immediately and can be printed
straight away. It is **not unique** — every roll cut from paper 639 carries 639.

**`roll_number` uniqueness is only checked server-side.** Two phones can each register
`RT-0500` offline; the second one to flush gets a **409**. That is rule 2's halt case, and
the user has to be told which number to change. Warn locally when the number already
exists on the device — it catches the common case early — but it is not a guarantee.

**Photos.** Never queue image bytes in the outbox. Upload the file, get a server path
back, send the path:

```
POST /api/media/upload            (multipart, field "file", ONE file per request)
  -> 201 { objectPath: "rolls/2026/08/<uuid>.jpg",   ← submit this, store this
           mediaUrl:   "https://…signed…" }          ← display only, it expires
```

`file:///…` device paths are rejected — only paths this API minted are accepted.

### Which order, and it depends on what is in the batch

Roll photos can be attached afterwards with PATCH. **Movement photos cannot** — there is no
`PATCH /api/stock/movements/:id`, so an OUT or RETURN must carry `photo_paths` in its create
body.

*Registration only (no movements)* — records first, so the ledger is right in seconds:

```
1. flush the outbox        20 rolls in one /sync/batch call
2. upload the photos       40 files, in parallel
3. PATCH each roll         attach the object paths
```

*Anything with OUT or RETURN photos* — upload first, then flush:

```
1. upload the photos       collect objectPaths
2. write them into the queued rows in SQLite
3. flush the outbox        records carry their paths
```

### The photo queue may run in parallel. The outbox may not.

| Queue | Concurrency | Why |
|---|---|---|
| `outbox` | **one at a time, FIFO** | `remaining_weight` is derived from movement order |
| `pending_photos` | **3–4 concurrent** | uploads are independent; nothing derives from their order |

The FIFO rule is about the ledger, not about images. Draining 40 photos one at a time over
a warehouse link is needlessly slow when four at a time is safe.

### Three more things

- **Compress before uploading.** A phone camera gives 3–5 MB a shot; 40 of those is ~160 MB.
  Resize to ~1600px on the long edge at JPEG quality 80 → 300–500 KB each, and the label
  text stays readable. The server's 20 MB cap is a ceiling, not a target.
- **Upload is NOT idempotent.** It has no `client_id`, so a retry writes a second object and
  orphans the first. Set `uploaded=1` on the row before moving on.
- **Retry per file, never per set.** That is why the endpoint takes one file per request —
  shot 37 failing must not re-send the 36 that worked.

---

## 6. Bulk actions — one screen, many rows

Several screens act on a list at once: register a batch of rolls off one delivery, scan
eight rolls and issue them all OUT to the same machine, return four of them together.

**The API takes one object per request. Fan the array out on the device — one local row
and one outbox item per roll or movement — and send them sequentially.**

```
User scans 8 rolls, taps "Issue OUT to Machine 3"
        │
        ├─ 8 INSERTs into stock_transactions   (8 local rows, sync_state='pending')
        ├─ 8 INSERTs into outbox               (8 client_ids, consecutive ids)
        │
        └─ flush → 8 sequential POSTs /api/stock/movements   (~1.6s in total)
```

The UI still treats it as one action: show a single "8 rolls issued" confirmation, and one
progress indicator over the group. That is a presentation concern. The queue underneath
stays one item per row.

### Why not one request with an array

Because a batch would need a single `client_id`, and a batch-level id cannot describe a
partial result. Connection drops after the server has written 5 of 8: the retry arrives,
the server sees a `client_id` it has already recorded, and answers "already done" — while
three rolls never moved and the phone has no way to discover which. Recovering from that
needs a per-item result array in the response and per-item reconciliation on the device,
which is the same bookkeeping as sending N requests, plus a new endpoint and a second
write path into the same collections.

Per-item ids make the same failure trivial: on retry the 5 already written come back as
replays, the remaining 3 are created, the queue drains. Nothing to reconcile.

### The cost

A create is roughly 200ms. Realistic batches:

| Rolls in one action | Flush time |
|---|---|
| 8 | ~1.6s |
| 30 | ~6s |
| 100 | ~20s |

This runs in the background after signal returns — nobody is watching the screen. Batching
starts to earn its keep in the hundreds, over a link bad enough that per-request overhead
dominates. If that day comes the change is contained: the device already holds an ordered
queue, so it is a client change plus one endpoint looping over the same service methods.
Do not build it in advance.

### Backup path: `POST /api/sync/batch`

A batch endpoint exists for when one-request-per-item is too slow — a long backlog over a
poor link. **Prefer the per-item flush**; reach for this when measurements say to.

```jsonc
POST /api/sync/batch
{
  "items": [
    { "type": "roll", "client_id": "<uuid-a>",
      "body": { "roll_number": "RT-0501", "material_id": "...", "vendor_id": "...",
                "weight": 60, "gsm": 90, "width": 1200,
                "location": "Bay 2", "date": "2026-08-27" } },

    { "type": "movement", "client_id": "<uuid-b>",
      "roll_client_id": "<uuid-a>",          // the roll above — it has no server id yet
      "body": { "transaction_type": "OUT", "material_id": "...", "location": "Machine 3" } }
  ]
}
```

- Max **50** items. Send the rest in the next call.
- **Every item keeps its own `client_id`**, and it is required here (optional on the
  single-item routes). The batch itself has no id — that is deliberate, see below.
- `roll_client_id` is how a movement points at a roll registered earlier in the same batch,
  or in an earlier batch. Omit it when `body.roll_id` is already known.
- Items run in array order, one at a time, through the same service code the single-item
  endpoints use.

**The response is always 200, even when items fail** — a batch is not a transaction, and
items already written stay written:

```jsonc
{
  "applied": 1, "failed": 1, "skipped": 1,
  "resume_from": 1,                  // index to retry from; null when everything applied
  "results": [
    { "index": 0, "client_id": "...", "type": "roll", "status": "ok", "data": { } },

    { "index": 1, "client_id": "...", "type": "roll", "status": "failed",
      "code": 409,                   // the status this item would have returned alone
      "reason": "duplicate",         // switch on THIS, never on the prose
      "error": "A roll with this number already exists",   // show verbatim
      "fields": { },                 // validation only: which inputs to highlight
      "detail": null },              // server_error only: raw cause, for your log

    { "index": 2, "client_id": "...", "type": "roll", "status": "skipped" }
  ]
}
```

### The failure fields

| Field | Use |
|---|---|
| `reason` | Branch on this. Stable — `error` wording will change |
| `error` | Show to the operator **as-is**. Do not substitute your own copy |
| `code` | The HTTP status the item would have returned on its own endpoint |
| `fields` | `{ "location": ["Where is the roll going? ..."] }` — highlight those inputs |
| `detail` | Present only on `server_error`. The raw cause, for your crash log and bug reports. **Never display it** |

`reason` is one of:

| `reason` | Means | What the app should do |
|---|---|---|
| `validation` | Malformed, or breaks a rule | Open the item for editing; show `error` and `fields` |
| `duplicate` | `roll_number` already exists | Ask the operator for a different number |
| `conflict` | The roll is not in a state that allows this — already out, not out, already used | Show `error`; usually the device's copy is stale, so pull a delta |
| `not_found` | A referenced record is gone | Refresh the cached lists, then retry |
| `forbidden` | This account may not do this | Read-only mode; the queue cannot drain |
| `server_error` | Our bug | Keep the item queued and retry later. **Nothing is wrong with the item** |

The split that matters: `server_error` is the only one where retrying unchanged is
correct. Everything else needs a person or a refresh first, which is why the flush halts.

Handling it:

1. Every `"ok"` — mark that outbox row sent, using the returned `data` exactly as you would
   the single-item response.
2. A `"failed"` — treat `code` exactly as §8's table says for that status. The batch stops
   there on purpose: later items may depend on it.
3. Every `"skipped"` — untouched, still pending. Leave the rows alone.
4. Retry from `resume_from` once the failure is resolved. Resending the whole batch is also
   safe: the already-applied items come back as replays.

**Never give the batch a single `client_id`.** A batch-level id cannot express "5 of 8
written" — the retry would be told the work was done while three rolls had never moved.

### One thing to get right

Order still matters **within** a batch. If the group contains a roll registration and a
movement against that same roll, the registration must be queued first — `outbox.id`
already guarantees it, provided both are inserted in the order the user performed them.
Insert them in a single SQLite transaction so a crash mid-enqueue cannot leave a movement
queued without its roll.

---

## 7. Request fields quick reference

| Endpoint | Offline-relevant fields |
|---|---|
| `POST /api/material-rolls` | `client_id` (UUID, optional) → idempotent create |
| `GET /api/material-rolls` | `updated_after` (ISO date) → delta pull, sorted `updatedAt` asc |
| `PATCH /api/material-rolls/:id` | **cannot** change `client_id` — rejected with 400 |
| `POST /api/stock/movements` | `client_id` (UUID, optional) → idempotent movement |
| `GET /api/stock/movements` | `updated_after` (ISO date) → delta pull |
| `GET /api/raw-materials` | none — full refresh |
| `GET /api/vendors` | none — full refresh; each vendor carries `papers[]` with the RT codes |
| `GET /api/locations` | `status=active` for the operator's picker — full refresh |
| `POST /api/media/upload` | multipart, field `file`, ONE file per request → `objectPath` |
| `POST /api/sync/batch` | up to 50 items, per-item `client_id` **required** → batch flush (§6) |

Both create responses echo `client_id`, `createdAt`, and `updatedAt`.

A replayed request returns the **original row** with the same HTTP status as a fresh
create. The device does not need to distinguish the two cases — that is the point.

---

## 8. Errors, auth, and housekeeping

### Error shape

Every failure from this API is the same JSON, whatever the status:

```json
{ "error": "Roll number RT-0500 already exists", "details": { } }
```

`error` is written to be shown to a user as-is — do not substitute your own copy for it.
`details` is present only on validation failures (Zod's flattened field errors) and is for
highlighting the offending field, not for display.

### How the flush must treat each status

| Status | Meaning | What the flush does |
|---|---|---|
| 200 / 201 | Written, or recognised as a replay | Mark synced, move to the next item |
| **400** | Validation failed | **Halt.** Show `error`. The item cannot succeed unedited |
| **401** | Token rejected | **Pause, re-login, resume. Never discard the queue** — see below |
| **403** | Role not permitted to write | **Halt.** See below — this is a setup problem, not a data problem |
| **409** | Duplicate `roll_number` | **Halt.** The user must change the number |
| 429 | Rate limited | Back off, retry the same item |
| 500 / 502 / 503 / 504 | Server or database trouble | Back off, retry the same item, same `client_id` |

503 is deliberate, not incidental: the API returns it when the database is unreachable.
It is always safe to retry.

### 401 — the queue outlives the session

Access tokens currently do not expire, so a phone offline for a week still flushes fine.
But a server-side secret rotation invalidates every outstanding token at once, and then
every queued item gets a 401.

**A 401 must never drop, clear, or fail the outbox.** Pause the flush, send the user to
the login screen, and resume the same queue with the same `client_id`s afterwards. A
logout that wipes local data must refuse to run while `outbox` has pending rows, or warn
loudly — those rows are the only copy of work done in the warehouse.

### 403 — check the role at login, not at flush time

Writing rolls and movements requires the **`admin`** or **`store_manager`** role. Any other
role gets a 403 on every write, which means a queue that can never drain and a user who has
been recording work all day for nothing.

Read the role from the login response and, if it is not one of those two, put the app in
read-only mode up front: no capture screens, no queue. Failing at login is recoverable;
failing at flush is not.

### Roll entry is manual

**Per the client's current requirement, roll details are typed in by the operator.** Both
online and offline, registration is a manual form — there is no scan-to-prefill step to
build, and nothing here depends on one.

`POST /api/ocr/roll-label` remains available on the backend and is not being removed. If
the client asks for label scanning later, note that it is a cloud call: it works only with
signal, and it **must never go in the outbox**. Everything in the outbox is a write that
has to reach the database eventually; OCR is a query whose answer the operator is waiting
on, so a queued one would arrive hours after the form it was meant to fill.

### Device clock

`transaction_date` comes from the device, so a phone with a wrong clock produces a
misdated ledger row. Nothing on the server corrects this. Two consequences:

- Show the date on the confirmation screen so an obviously wrong one gets caught.
- **Never derive a checkpoint from device time.** `rolls_checkpoint` and
  `movements_checkpoint` must only ever be copied from a server `updatedAt` value. A
  checkpoint from a fast device clock silently skips rows forever.

### Outbox housekeeping

- Delete rows with `status='sent'` older than a few days. They are receipts, not history —
  the real record is in the mirror tables.
- **Never** delete `status='failed'` rows automatically. Those are unresolved work and need
  a screen where a user can see them, edit, and requeue.
- Show a persistent badge whenever anything is pending or failed. A silently stuck queue is
  the worst outcome available: the warehouse believes the stock figures are current.

### Editing a roll that changed on the portal

`PATCH /api/material-rolls/:id` is last-write-wins — there is no version check. A phone
holding a copy from this morning will overwrite a change made on the portal at lunchtime.
Send only the fields the user actually edited, never the whole cached row, and the blast
radius stays limited to those fields.

---

## 9. Checklist before shipping

- [ ] Outbox drains sequentially, in `id` order, one request in flight at a time
- [ ] `client_id` is minted once at enqueue and never regenerated on retry
- [ ] Flush halts on the first 400 / 403 / 409 and surfaces the server's `error` text
- [ ] 5xx / 429 / timeout retries with backoff, same `client_id`
- [ ] 401 pauses and re-logins — it never clears the queue; logout is blocked while pending
- [ ] Non-writing roles are put in read-only mode at login, before anything is captured
- [ ] Failed outbox rows are visible, editable, and requeueable — never auto-deleted
- [ ] A pending/failed badge is visible whenever the queue is not empty
- [ ] Checkpoints saved from the **last row of the last page**, per collection
- [ ] Rolls with `sync_state='pending'` are visibly marked as unsynced in the list
- [ ] Photos live in their own queue, never as bytes in an outbox item
- [ ] Photo order: records-first for registrations, upload-first when a movement has photos
- [ ] Photo queue runs 3–4 concurrent; the outbox stays strictly one at a time
- [ ] Images compressed (~1600px, q80) before upload, and retried per file
- [ ] Reference data (materials, vendors + papers, locations) refreshes on login and
      foreground; a failed refresh keeps the old copy
- [ ] Location picker renders in `sort_order`, grouped by `godown`, filtered to active
- [ ] `location` is sent as the bay's NAME string, never its id
- [ ] Airplane-mode test: register a roll, issue it OUT, kill the app, reopen, restore
      signal — exactly one roll and one movement land on the server
