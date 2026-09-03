# Royal Touch Backend — Flow & Logic

What the server does when the mobile app calls it: the roll lifecycle, the weight
arithmetic behind every movement, what is derived rather than sent, and which rules will
reject a request.

Companion documents:
- `offline-sync-mobile.md` — SQLite schema, outbox, flush rules
- `royal-touche-mobile.postman_collection.json` — runnable requests, every endpoint the app calls
- `royal-touche-admin.postman_collection.json` — the web panel's endpoints, for reference

---

## 1. The three things the system stores

**`material_rolls`** — one physical roll. Mutable: its weight, status and location change
as it moves.

**`stock_transactions`** — an **append-only ledger**. Every movement is a new row; rows are
never edited or deleted (except when an untouched roll is deleted, §7). This is the audit
trail, and it is why offline sync works at all — replaying an ordered log is a solved
problem.

**`stock_summary`** — a cached per-material total, recomputed after every movement. Never
written directly; always derived (§8).

The rule that follows from this: **stock figures are never edited, only moved.** A roll's
`remaining_weight` cannot be PATCHed — the API refuses it — because a weight that changed
without a ledger row behind it is a number nobody can explain later.

---

## 2. Roll lifecycle

```
                    register
                       │
                       ▼
                  ┌──────────┐   OUT    ┌────────┐
                  │ IN_STOCK │ ───────► │ ISSUED │
                  └──────────┘          └────────┘
                    ▲   │  ▲                 │
        RETURN      │   │  └─────────────────┘
     (weight > 0)   │   │       RETURN
                    │   │
                    │   │ CONSUME (the phone's is_consumed flag),
                    │   ▼ RETURN with returned_weight = 0, or ADJUSTMENT to 0
                    │ ┌──────────┐
                    └─│ CONSUMED │
                 IN   └──────────┘
```

| Status | Meaning | Accepts |
|---|---|---|
| `IN_STOCK` | On the rack, counts toward on-hand | OUT, IN, ADJUSTMENT, CONSUME |
| `ISSUED` | Out at a machine — still exists, not in the store | RETURN, CONSUME |
| `CONSUMED` | Used up (`remaining_weight` 0) | IN (restores it to IN_STOCK), CONSUME (no-op) |

A roll's status is **never set by the client**. `status` is rejected on PATCH — it follows
the movements.

---

## 3. Registering a roll

`POST /api/material-rolls`

Required: `roll_number`, `material_id`, `vendor_id`, `weight`, `gsm`, `width`, `location`,
`date`.
Optional: `batch_no`, `quantity`, `unit`, the four photo paths, `client_id`.

Server-side, in order:

1. **Replay check** — if `client_id` was seen before, the original roll is returned and
   nothing below runs.
2. **`roll_number` uppercased**, then checked for uniqueness → **409** if taken.
3. **Material and vendor loaded and checked usable** — a retired (`inactive`) material or
   vendor is refused, so new stock cannot be booked against something deliberately taken
   out of circulation.
4. **`royal_touche_code` stored as sent** — Royal Touche's code for the base paper
   (e.g. `639`), read off the label like `roll_number`. Required, uppercased, and **not
   unique**: it names the paper, so every roll cut from paper 639 carries 639. The server
   mints nothing, which is why a phone can fill it in offline.
5. **`remaining_weight` defaults to `weight`** — a newly received roll is full. Passing a
   `remaining_weight` above `weight` is a 400.
6. **An `IN` ledger row is written automatically** — dated `date` (when the roll *arrived*,
   not when it was keyed in), carrying the registration photos so the history has something
   to show. **Do not post your own IN after registering; it is already there.**
7. **The material's summary is refreshed.**

> Rolls registered before 27-08-2026 carry a generated code (`<VENDOR_CODE>-0001`) from
> the earlier auto-minting behaviour. They are untouched; only new rolls take the code
> from the label.

---

## 4. The weight model

Three different numbers, routinely confused:

| Field | Meaning | Changes? |
|---|---|---|
| `weight` | What the roll held when it arrived. Its ceiling. | Only by PATCH |
| `remaining_weight` | What is on it now. **The stock figure.** | Only via movements |
| `quantity` | Length or pieces — reference data printed on the label | Only by PATCH |

`quantity` **never moves**. Every movement is about weight.

Two invariants the server enforces:

- `remaining_weight` can never exceed `weight` — an IN or ADJUSTMENT that would exceed it
  is a 400 naming the ceiling.
- A RETURN cannot come back heavier than it went out — 400.

---

## 5. The four movement types

`POST /api/stock/movements`. Every type needs `material_id`, and the roll must belong to
that material (400 otherwise).

### OUT — a roll goes to a machine

Requires `roll_id` and `location` (the destination). **Must NOT send `weight`** — the whole
roll leaves; usage is declared on the return. Sending one is a 400.

```
roll.status         → ISSUED
roll.location       → the destination
roll.remaining_weight → UNCHANGED (nothing consumed yet, it is just elsewhere)

row.weight            = the whole remaining weight (what physically left the store)
row.roll_weight_after = unchanged
row.from_location     = where it was; row.to_location = where it went
```

Refused with **409** if the roll is already `ISSUED`, or if it is empty.

### RETURN — the roll comes back

Requires `roll_id` and `returned_weight`. **`returned_weight` is the scale reading** — what
the roll weighs now, not what was used. **Do not ask the operator for a location:** the
server reads the destination off the roll's own most recent OUT row and sends it home.

```
used                  = remaining_weight_before − returned_weight   ← DERIVED
roll.remaining_weight → returned_weight
roll.status           → IN_STOCK, or CONSUMED when returned_weight is 0
roll.location         → back to the OUT row's from_location

row.weight            = returned_weight (what the store got back)
row.used_weight       = the derived usage
```

Refused with **409** if the roll is not currently `ISSUED`.

### IN — weight added back

Requires `weight`. Written automatically on registration (§3); send one manually only for a
genuine receipt. Adds to `remaining_weight`, capped at `weight`. A `CONSUMED` roll returns
to `IN_STOCK`.

### ADJUSTMENT — correcting a physical count

Requires `roll_id`, `new_weight`, and **`remarks`** — an unexplained correction to a stock
figure is the one thing nobody can audit later, so it is mandatory. Sets
`remaining_weight` to `new_weight`; the delta is derived. `new_weight` of 0 marks the roll
`CONSUMED`.

### CONSUME — the roll is finished

The one movement with nothing to measure: the operator sees an empty core, so there is no
scale reading to give. The phone sends the roll and a flag and nothing else:

```json
{ "roll_id": "…", "is_consumed": true, "client_id": "…" }
```

`is_consumed: true` becomes `transaction_type: "CONSUME"` at the schema boundary, so the
ledger still carries one honest row for it. `material_id` is read off the roll — the app
does not send it. `used_weight` is whatever was left on the roll, `remaining_weight`
becomes 0, and the status becomes `CONSUMED`.

Valid from either live state. A roll that was `IN_STOCK` takes its weight out of on-hand
here; a roll that was `ISSUED` left on-hand at its OUT, so the total does not move again —
only the roll closes.

Consuming an **already-`CONSUMED`** roll is accepted as a no-op — a row with `weight` and
`used_weight` of 0 — not a 409. A `RETURN` weighed at 0 already closes the roll, and a
device that queued both that return and a consume for the same empty core would otherwise
have its entire flush halted by the second one. The flag only ever asserts "this roll is
finished", which is already true.

`weight`, `new_weight` and `returned_weight` are **rejected** on a CONSUME. A scale reading
means it is a RETURN, not a consume.

### Every movement also gets

- `description` — a ready-to-render sentence (`"Returned 180 kg to Bay 2 · 70 kg used"`).
  **Render it as-is**; do not rebuild it from the numbers.
- `material_weight_after` — the material's on-hand total after this movement.
- `roll_weight_after` — the roll's weight after this movement.
- `photo_paths` (max 4) + signed `photo_urls`.

---

## 6. Roll history

**There is no history array on the roll.** The roll carries only its current state; its
history *is* the ledger — every row in `stock_transactions` that points at it. That is the
whole reason the ledger is append-only.

```
GET /api/stock/movements?roll_id=<id>&page=1&pageSize=50
GET /api/stock/movements?roll_number=RT-0512&page=1&pageSize=50
```

Both return the same thing. Use `roll_number` when the operator has just scanned a
barcode — the server resolves the printed number to the roll itself, so the app does not
need a lookup round trip first. An unknown number returns an **empty list, not an error and
not every movement in the store**.

**Sorted newest first** (`transaction_date` descending, `_id` breaking ties) — the order a
history screen wants. Adding `updated_after` flips it to oldest-first for delta pulls; do
not mix the two on a history screen.

### What a history row already contains

Each row is self-describing; the screen should not need to compute anything:

| Field | Use |
|---|---|
| `description` | **Render as-is** — `"Returned 180 kg to Bay 2 · 70 kg used"` |
| `transaction_type` | `IN` / `OUT` / `RETURN` / `ADJUSTMENT` / `CONSUME` — for the icon and colour |
| `transaction_date` | When it happened (not when it was keyed in) |
| `weight` | What moved on this row |
| `used_weight` | RETURN and CONSUME; `null` elsewhere |
| `roll_weight_after` | The roll's weight after this row — the running balance |
| `from_location` / `to_location` | The move |
| `issued_to`, `remarks` | Who and why |
| `photo_paths` / `photo_urls` | Paths round-trip, URLs render (signed, they expire) |
| `created_by` | `{ id, name }` of the user who recorded it |

A complete history reads as a running balance without any client-side arithmetic:

```
27 Aug  Received 250 kg                          → 250      (written by registration)
27 Aug  Issued out 250 kg to Machine 3           → 250
27 Aug  Returned 180 kg to Bay 2 · 70 kg used    → 180
```

Note the first row: **registration writes its own `IN`**, dated when the roll arrived. It
carries the four registration photos, so the history has something to show for the roll as
it was received.

### History offline

The history screen must work with no signal, so build it from the device's own
`stock_transactions` mirror rather than calling the API:

```sql
SELECT * FROM stock_transactions
 WHERE roll_local_id = ?
 ORDER BY transaction_date DESC, local_id DESC;
```

Two consequences worth designing for:

- **Pending rows have no `description`** — the server renders it. Compose a local
  equivalent for rows still in the outbox, and replace it with the server's text once they
  sync. Mark them visibly as pending.
- **`roll_weight_after` is also server-computed.** Predict it locally for display if you
  want a running balance offline, but overwrite from the response — never treat the local
  guess as the stock figure.

Keep the mirror current with the movements delta pull (see offline-sync-mobile.md §3), and remember that a roll's
history can gain rows the phone never queued: someone on the portal can issue or adjust the
same roll.


## 7. Deleting a roll

`DELETE /api/material-rolls/:id` works **only while the roll is untouched** — `IN_STOCK`
and `remaining_weight === weight`. Anything else is a **409**. A deleted roll takes its
automatic IN row with it, since it never really existed.

> **Gap:** a delete is invisible to the delta pull, so a device keeps the roll forever.
> There are no tombstones. Until there are, the only recovery is dropping the checkpoint
> and re-pulling everything.

---

## 8. On-hand totals

`GET /api/stock/summary` returns cached per-material totals, recomputed after every
movement:

```
total_weight = Σ remaining_weight WHERE status = IN_STOCK AND remaining_weight > 0
total_rolls  = count of those rolls
```

**An `ISSUED` roll is not on hand.** It still has weight, it is just not in the store — so
it drops out of the total until it returns. Weight alone is not the filter; status is.

---

## 9. Errors

Every failure is `{ "error": "…", "details": { } }`. **`error` is written to be shown to
the user verbatim.** `details` appears on validation failures and is for highlighting the
offending field.

| Status | Cause | Client action |
|---|---|---|
| 400 | Validation, or a rule like "OUT must not send weight" | Show `error`, let the user fix it |
| 401 | Token rejected | Re-login, **keep the queue** |
| 403 | Role cannot write | Read-only mode — check at login, not at flush |
| 404 | Unknown id | Stale local copy; re-pull |
| 409 | Duplicate `roll_number`, roll already out, roll not out, roll already used | Show `error` |
| 500/502/503/504 | Server or database trouble | Retry with backoff |

503 specifically means the database is unreachable — always safe to retry.

---

## 10. Roles

`admin` and `store_manager` may write rolls and movements. Every other role gets **403** on
every write while still being able to read. Check the role from the login response and put
the app in read-only mode there — a queue that can never drain is discovered at the end of
a shift otherwise.

---

## 11. Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | Tokens do not expire |
| GET | `/api/raw-materials` | Full list, cache it |
| GET | `/api/vendors` | Full list, cache it |
| GET | `/api/material-rolls` | Paginated. `q`, `material_id`, `vendor_id`, `status`, `location`, `updated_after`, `page`, `pageSize` (max 200) |
| GET | `/api/material-rolls/:id` | |
| POST | `/api/material-rolls` | Writes the IN row for you |
| PATCH | `/api/material-rolls/:id` | Rejects `remaining_weight`, `status`, `client_id` |
| DELETE | `/api/material-rolls/:id` | Untouched rolls only |
| GET | `/api/stock/movements` | `roll_id`, `roll_number`, `transaction_type`, `updated_after`, paging |
| POST | `/api/stock/movements` | The four types above |
| GET | `/api/stock/summary` | Optional `material_id` |
| POST | `/api/media/upload` | multipart, field `file`, one per request |
| POST | `/api/sync/batch` | Up to 50 queued writes in one call |
| POST | `/api/ocr/roll-label` | Online only, never queued |

`q` searches `roll_number`, `royal_touche_code` and `batch_no`, case-insensitively.

---

## 12. Photos

Two steps, always. Never send image bytes in a record.

```
POST /api/media/upload   (multipart, field "file", ONE file per request)
  → 201 { "objectPath": "rolls/2026/08/<uuid>.jpg",
          "mediaUrl":   "https://…signed…" }
```

- **`objectPath`** is what you submit back and what the database stores.
- **`mediaUrl`** is a signed URL for display only — it expires. Never store it.
- Paths are validated against `rolls/YYYY/MM/<uuid>.<ext>` — only what this API minted.
  That stops a client pointing a roll at any other object in the bucket, which also holds
  invoice scans.
- One file per request by design, so a failed shot is retried alone rather than the whole
  set. Mirror that in the app's photo queue.
- Upload is **not** idempotent — it has no `client_id`, and a retry writes a second object.
  Harmless, but mark the local row uploaded before moving on or a flaky link fills the
  bucket with orphans.

Attach the paths:

```jsonc
// roll
{ "tag_photo_path": "rolls/2026/08/…jpg", "stitched_barcode_photo_path": "…",
  "side1_photo_path": "…", "side2_photo_path": "…" }

// movement — array, max 4
{ "photo_paths": ["rolls/2026/08/…jpg", "rolls/2026/08/…jpg"] }
```

**Ordering, and this is the part that constrains the flush:** rolls can be patched after
the fact, **movements cannot** — there is no `PATCH /api/stock/movements/:id`. A movement's
photos must be in the body when it is created. So on reconnect:

```
1. upload every pending photo   → collect objectPaths
2. write the paths into the queued items in SQLite
3. flush the outbox             → records carry their paths
```

Roll photos could go the other way (record first, PATCH after) to get the ledger correct
sooner, but since movements force step 1 anyway, doing both the same way is simpler.

---

## 13. What the client must not assume

- **`royal_touche_code` is yours to send**, off the label, and is not unique. Do not expect
  the server to generate or validate it against a paper master.
- **`remaining_weight` and `status` are server-owned.** Predict them locally for display if
  you must, but overwrite from the response — never PATCH them.
- **Usage is derived, never sent.** RETURN takes the scale reading; the server subtracts.
- **Do not ask for a return location.** It comes from the roll's own OUT row.
- **Do not post an IN after registering a roll.** Registration writes it.
- **`roll_number` uniqueness is only checked server-side.** Two phones can queue the same
  number offline; the second to flush gets a 409. Warn locally, but it is not a guarantee.
- **`description` is server-rendered.** Show it; don't rebuild it.
- **PATCH is last-write-wins**, no version check. Send only the fields the user edited,
  never a whole cached row.
