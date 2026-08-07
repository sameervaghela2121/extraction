# GRN Data Sharing API — Overview

This document explains the two API endpoints built so your system can automatically read Goods Receipt Note (GRN) data from our platform, and send back a status update for each record. No login or API key is required to use these — they're built to be called directly by your system.

Replace `https://your-domain.com` in every example below with our actual server address once you have it.

---

## What a GRN record contains

Every GRN record returned by these APIs includes, in one response:

- The **original document** — a direct link to the scanned invoice/receipt file (PDF or image), viewable in a browser
- The **purchase invoice details** — seller, buyer, GSTINs, invoice number/date, tax amounts, and the full list of items on the invoice
- The **goods actually received** — the item list and quantities as recorded on our side
- A **match indicator** — `true` if what was received matches what the invoice says was shipped, `false` if there's a discrepancy on any line
- A **status field** (`grnStatus`) — this is yours to set. It starts empty (`null`) on our side, and your system sets it to whatever value makes sense to you (e.g. `"DISPATCHED"`, `"RECEIVED"`, `"PROCESSED"`) using the second endpoint below.

---

## Endpoint 1 — Get GRN records for a date

Use this to pull all GRN records created on a given day.

**Endpoint:** `GET https://your-domain.com/api/public/grn`

**Method:** `GET`

**Query parameters:**

| Parameter | Required | Example | Description |
|---|---|---|---|
| `date` | Yes | `2026-07-28` | Fetches every GRN record created on this date. Format: `YYYY-MM-DD`. |
| `grnStatus` | No | `DISPATCHED` | Narrows the results to only records currently set to this status. Leave it out to get every record for that date regardless of status. |

**Example — get everything from a specific date:**

```bash
curl "https://your-domain.com/api/public/grn?date=2026-07-28"
```

**Example — get only records from that date with a specific status already set:**

```bash
curl "https://your-domain.com/api/public/grn?date=2026-07-28&grnStatus=DISPATCHED"
```

**Response** — a list of matching records, each shaped like this:

```json
{
  "items": [
    {
      "id": "68f4a1b2c3d4e5f678901234",
      "title": "scan-1784886663317.pdf",
      "fileUrl": "https://storage.googleapis.com/.../original-document.pdf",
      "invoiceNo": "793/26-27",
      "invoiceDate": "04-06-2026",
      "status": "approved",
      "grnStatus": null,
      "match": true,
      "createdAt": "24-07-2026",
      "items": [
        { "description": "Item name", "quantity": 540, "unit": "Kgs" }
      ],
      "invoice": {
        "sellerName": "Example Seller LLP",
        "buyerName": "Example Buyer LLP",
        "grandTotal": 472410,
        "items": [
          { "description": "Item name", "qty": 540, "unit": "Kgs", "rate": 435, "amount": 472410, "mismatch": false }
        ]
      }
    }
  ],
  "total": 9
}
```

**In plain terms:**
- `fileUrl` — open this directly in a browser or embed it in your own screen to show the original document.
- `match` — quick true/false check: did the received quantities line up with the invoice.
- `grnStatus` — currently whatever your system last set it to (see Endpoint 2), or empty if you haven't set it yet.
- `total` — how many records matched your date (and status, if you filtered by one).

---

## Endpoint 2 — Update the status on a GRN record

Once your system has processed a record (from Endpoint 1), use this to write your own status back onto it.

**Endpoint:** `PATCH https://your-domain.com/api/public/grn/{id}`

Replace `{id}` with the `id` value from the record you got back from Endpoint 1.

**Method:** `PATCH`

**Body** (JSON):

| Field | Required | Example | Description |
|---|---|---|---|
| `grnStatus` | Yes | `"DISPATCHED"` | Any text value you want. There's no fixed list — whatever your system calls this stage is what gets stored. |

**Example:**

```bash
curl -X PATCH "https://your-domain.com/api/public/grn/68f4a1b2c3d4e5f678901234" \
  -H "Content-Type: application/json" \
  -d '{"grnStatus": "DISPATCHED"}'
```

**Response** — confirms what was saved:

```json
{
  "id": "68f4a1b2c3d4e5f678901234",
  "grnStatus": "DISPATCHED"
}
```

**What happens if something's wrong:**

| Situation | What you'll get back |
|---|---|
| `grnStatus` left blank or missing from the request | An error response — this field can't be empty. |
| The `id` in the URL doesn't match any GRN record | "Not found" error. |

---

## Quick summary for your dev team

1. Call **Endpoint 1** with a date to pull that day's GRN records — each one already includes the invoice, the received items, the document link, and a match flag, so no extra lookups are needed.
2. Once your system has done whatever it needs to with a record, call **Endpoint 2** with that record's `id` to write your own status back onto it.
3. Calling Endpoint 1 again later — optionally with `&grnStatus=...` — lets you check which records you've already marked, versus which are still pending.
