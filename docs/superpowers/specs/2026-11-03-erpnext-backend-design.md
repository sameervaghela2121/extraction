# Royal Touche — ERPNext as the backend (design)

Date: 2026-11-03 · Branch: `feature/krunal-implementation` · Status: draft for approval

## 1. Intent

Royale Touche manufactures laminates. Its godown receives decor-paper rolls from vendors,
issues them to production, takes back what is left, and finally marks each roll consumed,
returned to its vendor or sold. Today that runs on our own Node + MongoDB backend, an
offline-first Android app (tablet and phone) and a React admin portal.

Nothing is broken. We are moving the backend onto **ERPNext** because it is built for
exactly this — receipts, batches, warehouses, a stock ledger, returns, deliveries — and is
used by thousands of businesses, so the stock arithmetic underneath is proven. It also
gives room to grow: purchasing, pricing and more warehouses already exist in it, ready to
switch on.

**Savio stays the company's main ERP** (accounts, billing). This system is the
**warehouse and inventory** system.

## 2. Decisions already made (by the business)

- ERPNext replaces the Node backend completely. Node is retired after cut-over.
- Our two frontends stay: the Android app and the React admin portal. No new frontend is
  built inside ERPNext. ERPNext's own Desk screens are available to admins as a bonus.
- Hosting: our own Google Cloud server (Compute Engine VM, project `royal-touche`, region
  `asia-south1`). Database: MariaDB (ERPNext's supported database), plus Redis.
- No label ZPL from the server — labels print from the browser.
- No prices now. They must be addable later without drastic change (§7).
- Rolls are sometimes **sold**. Rate, when it comes, is **per roll**, not per kg.
- The Savio bill number on a sale is **optional** for now.
- Buyers are added **only in the portal**. The tablet picks from the synced list and
  never creates one.
- ERPNext Company: **Royale Touche**.
- **Standard ERPNext APIs over today's routes.** Today's URL paths and JSON shapes are
  not kept for their own sake; the tablet app and portal are changed to fit ERPNext's
  standard API style wherever that is the better design (§4).
- Out of scope: the document / AI modules (documents, general vouchers, GRN, public GRN,
  field definitions, export, OCR).

## 3. Goals, non-goals, anti-goals

**Goals**
- Every scenario in §5 works on ERPNext with today's behaviour.
- The tablet keeps working fully offline, with the same local database, outbox and
  delta sync it has today.
- Reports give **the same numbers** as today's for the same movements.
- Price, buyer and accounting fields exist in the right ERPNext places, empty, ready.

**Non-goals (now)**
- Accounting, GL, GST, pricing screens, Savio integration.
- Moving the document / AI modules.
- Redesigning the app or portal screens beyond what §8 lists.

**Anti-goals: the move fails if any of these happen, even if it "works"**
- A retried sync creates a second roll, lot or movement.
- The tablet stops working offline, or first sync becomes noticeably slower.
- A consumption or daily-status figure differs from what today's backend gives.
- Godown staff can see prices once prices exist.
- A stock figure changes without a ledger entry behind it.

## 4. Architecture

```
Android app (offline, scan, weigh)  ─┐
                                     ├─► nginx ─► ERPNext + custom app `royal_touche`
React admin portal                  ─┘                │
                                                      ├─ API: standard REST + custom business actions  
Admins / accounts (optional)  ─► ERPNext Desk         ├─ stock: Purchase Receipt, Stock Entry,
                                                      │   Delivery Note, Batch, Warehouse, Stock Ledger
                                                      └─ MariaDB · Redis · workers · scheduler
Photos: Frappe File records, stored in Google Cloud Storage
```

- All our logic lives in one Frappe app, `royal_touche`, installed on ERPNext. ERPNext
  core is never edited.
- One API call = one database transaction (Frappe's default). A movement and the
  ERPNext stock document behind it are written together or not at all.
- ERPNext version: the current stable major at build time, pinned.

**API style: standard first, custom only for business actions**

| Kind of call | How |
|---|---|
| Reading records (masters, buyers, lots, rolls, movements) | Standard REST `/api/resource/<DocType>`: `filters`, `fields`, `order_by`, paging |
| Delta pulls for the tablet | Same, filtered `modified >= checkpoint`, ordered `modified asc, name asc` |
| Simple master edits (portal) | Standard REST create / update |
| Business actions: register roll, OUT, IN, consume, return to vendor, sell, `sync batch` | Custom whitelisted methods `royal_touche.api.*`: they write several records in one transaction and apply our rules and the `client_id` replay guard |
| Reports | Frappe Script Reports, called through the standard report API (also usable in Desk, with export) |
| Login | Portal: standard Frappe session (cookie). App: Frappe's built-in OAuth2 provider (bearer + refresh token) |
| Photos | Standard Frappe file upload, attached to the record, stored in GCS (§10) |

Two rules make the standard API safe:
1. **Business rules live in document hooks** (`validate`, `before_submit`, ...), not only in
   endpoints, so they hold for the app, the portal and Desk alike.
2. **Godown roles get no direct create/submit permission on stock documents** (Stock
   Entry, Purchase Receipt, Delivery Note, Stock Reconciliation). Only the business-action
   methods create them, after checking our rules.

The portal is served from the **same domain** as ERPNext (nginx), so the session cookie
works with no CORS set-up.

## 5. Scenarios to cover

Source of truth for today's behaviour: the Node code in `backend/src` (services and
validators), then `docs/backend-flow-and-logic.md` and `docs/offline-sync-mobile.md`.
Where the docs and the code disagree, the code wins. What must be kept is the business
behaviour (rules, arithmetic, outcomes), not the old API shape.

**A. Login and users**
1. Login, refresh, logout, "me" (the app reads the role at start).
2. Roles in use: `super_admin`, `admin`, `godown_supervisor`, `godown_operator`, with
   today's permissions (see `requireRole` / `requireGodownWrite` / `canWrite` /
   `canManage` in `backend/src`).
3. Portal user management: create, edit, set password, invite, deactivate.

**B. Masters** (all soft-delete; all delta-synced to the tablet)
4. Vendors with their paper codes (paper code = `supplier_code_number`, RT code, Delta
   code, `is_common`, `found_in`); search; paper search. The tablet can create a vendor
   and a paper code offline (sync item types `vendor`, `supplier_code`).
5. Raw materials, 6. Locations, 7. Remarks — add, edit, deactivate, reorder.
8. **Buyers** (new): for sales; added and edited only in the portal, delta-synced to the
   tablet, which picks from them and never creates one.

**C. Receiving**
9. Lot: document type (challan / invoice), document number, photo; duplicate check;
   list with search, type filter, date sort, paging; created offline.
10. Barcode label batches (prefix + date + range; next number; search; delete). The
    tablet keeps a pool of free codes and reserves one per roll.
11. Roll registration: lot required; vendor, paper code, material, GSM, width; weight
    (scale, or typed if the role allows); barcode unique ignoring case; roll number;
    photos; offline; saved once however often it is retried.
12. Edit a roll; set its remark flags; delete a roll (soft; any roll, its movements are
    marked deleted with it, as `materialRolls.service.ts` `remove` does today).
13. Photo upload to GCS and short-lived read links.

**D. Movements**
14. OUT: the roll's whole available weight goes to a location (e.g. Running Godown) or
    person;
    dated today or yesterday; scale photo.
15. IN (return): the remainder comes back, never more than went out; 0 kg back means
    consumed.
16. Mark consumed. 17. Return to vendor (with remarks).
18. Mark sold — now with buyer, optional Savio bill no., optional rate per roll,
    optional photo, vehicle no. and remarks.
19. Status rules: IN_STOCK → OUT/return-to-vendor/sell; ISSUED → IN/consume; nothing
    after CONSUMED, RETURNED_TO_VENDOR or SOLD. Adjustment (count correction) as today.
20. Weight rules: an operator's weight only from the scale; supervisors and above may
    type. (Enforced in the app today; the server keeps today's checks.)
21. Movement list (delta); stock summary per material.

**E. Tablet sync**
22. `sync/batch`: ordered items, each with its own `client_id`; replays return the
    original result; a failed item skips only its dependants; results carry stable
    reason codes. Sync logs viewable by admins. Rules: `backend/src/services/sync.service.ts`.
23. Delta pulls ("changed since") for masters, buyers, lots, rolls, movements, including
    deactivated / deleted records.
24. First sync stays fast; delta pulls carry no photo links.

**F. Reports (portal)**
25. Consumption: daily / weekly / monthly; by material or by design (RT + Delta);
    summary and detail CSV; Opening + Received − Consumed − Returned to vendor − Sold ±
    Adjusted = Closing; IST business day. Logic: `consumptionReport.service.ts`.
26. Daily roll status CSV, 30 columns. Logic: `dailyRollReport.service.ts`.

**G. Other**
27. APK download link.

## 6. Data mapping

| Today (MongoDB) | ERPNext | Notes |
|---|---|---|
| `raw_materials` | **Item** (stock UOM kg, *Has Batch No* on) | one Item per raw material |
| `vendors` | **Supplier** | `vendor_code`, GST no., contact as fields |
| `vendors.papers[]` | child table **Vendor Paper** on Supplier | RT, Delta, paper code, `is_common`, `found_in` |
| `locations` | **Warehouse** | plus one warehouse **Unassigned** for rolls registered without a location |
| `remarks` | custom DocType **RT Remark** | code, label, sort order |
| buyers (new) | **Customer** | |
| `lots` | custom DocType **Roll Lot** | type, number, photo (File attachment), `client_id` |
| `material_rolls` | **Batch** (one per roll) + its **Purchase Receipt** | see below |
| `stock_transactions` | custom DocType **Roll Movement** + the ERPNext stock document | see below |
| `stock_summary` | derived from Stock Ledger / Bin | no separate cache needed |
| `barcode_batches` | custom DocType **Barcode Batch** | |
| `sync_logs` | custom DocType **Sync Log** | |
| `users` | **User** + custom roles | see §9 |

**Roll = Batch.** A Batch can be partly used, which a roll is (150 kg out, 80 kg back).
Custom fields on Batch: roll number, barcode (unique, stored upper-case), vendor, lot,
paper snapshot (RT, Delta, paper code), GSM, width, photos (File attachments), remark codes,
`client_id`, and cached `roll_status`, `remaining_weight`, `current_location` so the
tablet's roll pull reads one table.

**Registering a roll** submits one **Purchase Receipt** with one line: supplier = the
roll's vendor, item = its material, qty = weight (kg), warehouse = its location, batch =
the new Batch, custom link to the Roll Lot, rate 0. One receipt per roll is deliberate:
a lot is created first and rolls trickle in over hours, often offline, and a submitted
receipt cannot gain lines. It also gives return-to-vendor a receipt to return against.

**Movements.** Every movement creates one **Roll Movement** (our app-facing log: type,
date, weights before/after, issued to, from/to location, remarks, photos (attachments),
`client_id`, created by) and, in the same transaction, the ERPNext document that moves
the stock:

| Movement | ERPNext document |
|---|---|
| IN (registration) | Purchase Receipt (above) |
| OUT | Stock Entry — Material Transfer, roll's warehouse → the OUT's location |
| RETURN (IN back) | Stock Entry — Material Transfer back to the warehouse it went out from, for the returned weight (none if it had no home); plus Material Issue for the used weight |
| CONSUME | Stock Entry — Material Issue from the roll's current warehouse |
| RETURN_TO_VENDOR | Purchase Return against the roll's Purchase Receipt |
| SELL | Delivery Note to the buyer (Customer) from the roll's location |
| ADJUSTMENT | Stock Reconciliation for that batch |

Roll Movement holds the link to its ERPNext document. Roll Movement is what the app's
movement pull and our reports read; the Stock Ledger is the proof underneath. A check
(§11) asserts the two always agree.

**Backdating.** Movements may be dated today or yesterday (IST), as now. ERPNext
supports back-dated posting; the background repost it triggers is expected.

**ERPNext setup rules (decided here, builder may not change without asking)**
- One Company, currency INR, fiscal year April–March, time zone Asia/Kolkata.
- Perpetual inventory **on** from day one. With rates at 0 its ledger entries are zero,
  and pricing later needs no switch-over (that switch is hard once transactions exist).
- Nothing app-facing is ever hard-deleted. Masters are deactivated (`disabled` /
  status); a deleted roll has its Purchase Receipt cancelled and its Batch marked
  deleted. Delta pulls must return these, as today.
- App-facing records use lowercase ids (Frappe `hash` naming). The app lowercases a
  server id when looking a roll up, and ids are opaque to both clients otherwise.
- Barcodes and roll numbers are stored upper-case and unique, as today.

## 7. Price — designed in, switched off

- ERPNext's own rate fields are used everywhere and left at 0, with *Allow Zero Valuation
  Rate* on. No separate price table.
- Optional custom field **Rate per roll** on the Purchase Receipt line and the Delivery
  Note line. A server hook sets the line's per-kg rate = rate per roll ÷ the roll's kg, so
  the line amount equals the roll's price and ERPNext's own reports stay correct.
- Batch-wise valuation on: each roll keeps its own cost.
- Price fields sit at a permission level godown roles cannot read.
- API: `rate_per_roll` is an optional request field from day one; nobody sends it yet.
- Pricing stock received before pricing started: Landed Cost Voucher, no cancellations.
- "Roll" is not an ERPNext UOM (every roll weighs differently).

## 8. Frontend changes

Both clients are changed to fit the new API. The aim is a correct, standard design, not
the smallest diff.

**Android app**
- API layer rewritten: Retrofit interface, DTOs and mappers for Frappe's request and
  response shapes (`data` / `message` envelopes, `name` as id, Frappe error format),
  OAuth2 login and refresh, file upload.
- Local database, outbox, sync manager and screens stay. Room changes only where a field
  genuinely changes, plus a buyers table (with a migration, as for every schema change).
- Sell dialog: buyer picker (synced buyers only), optional Savio bill no., optional
  vehicle no., optional remarks; photo stays optional. Rate per roll is not shown yet.
- The sync batch keeps per-item `client_id`, in-order apply, replay results and
  dependants-only skipping: no standard Frappe equivalent exists for an offline queue.

**Admin portal**
- API layer and login rewritten for Frappe (session login, standard REST, report API).
- New Buyers master page (same pattern as the other master pages).
- Sale details (buyer, bill no.) shown on roll detail; bill no. editable later by
  admins (it is optional at the time of sale).

## 9. Auth and roles

- Custom ERPNext roles: RT Super Admin, RT Admin, Godown Supervisor, Godown Operator,
  carrying today's permissions.
- Portal: standard Frappe session login. App: Frappe's OAuth2 provider (bearer access
  token + refresh token), registered as an OAuth client. The builder confirms the grant
  type suits a first-party mobile app; token lifetimes match today's or are longer.
- Role-to-permission mapping is set in ERPNext role permissions, not hard-coded in
  endpoints, except where a business-action method checks a rule (e.g. operator weight).
- Passwords cannot be carried over from Node; users get new passwords at cut-over.

## 10. Photos

Standard Frappe **File** records, attached to their lot / roll / movement, private.
Storage is Google Cloud Storage through an S3-compatible storage integration (GCS
interoperability keys), so files survive the VM and do not fill its disk. Clients upload
with the standard upload API and read through Frappe's authenticated file URLs. (Prod has
no photos yet, so nothing needs moving.)

## 11. Testing and proof

- Unit tests in the Frappe app for every rule in §5-D and the sync replay rules.
- **Report parity:** run the October and September seed scenarios
  (`backend/src/utils/seedMonth.ts`, with its expected figures) against ERPNext; every
  figure must match.
- **Ledger agreement check:** for every roll, the Roll Movement weights equal the Stock
  Ledger's batch quantities.
- Tablet tests on the dev server: registration, all movements, offline queue then sync,
  retry of a half-applied batch. The user does every tap; the builder watches logs.

## 12. Environments, migration, cut-over

- Local: a native `bench` install on the developer machine (no Docker), with local
  MariaDB and Redis.
- Dev and prod: separate GCE VMs in `asia-south1`, Docker-based, nginx + HTTPS on a
  subdomain each. Daily backups (database + files) to GCS.
- Data to move from prod MongoDB: 75 vendors with 1,532 paper codes, 6 locations,
  3 raw materials, 3 remarks, 5 users. Rolls, lots and movements are 0 today; if that
  changes before cut-over, the import must carry them too.
- Cut-over: freeze, import, point a release build of the app and the portal at the new
  server, run first sync on each tablet, then retire Node and MongoDB.

## 13. Left to the builder

Internal Frappe structure; OAuth grant details (§9); which S3-compatible storage app
(§10); exact custom field names; paging details of delta pulls (keep `(modified, name)`
order); index choices on custom fields; VM size within reason (suggested 4 vCPU / 16 GB
for prod).

## 14. Resolved with the business

1. Buyers: portal only; the tablet never adds one.
2. Company name in ERPNext: Royale Touche.
3. Other services that may call Node: out of scope for now.
4. API style: standard ERPNext APIs; the app and portal change to fit (§4, §8).
