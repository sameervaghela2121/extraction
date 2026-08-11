# GRN Data Sharing API — Overview

This document explains the two API endpoints built so your system can automatically read Goods Receipt Note (GRN) data from our platform, and send back a status update for each record. No login is required — just the API key below, passed on every request — so these can be called directly by your system.

**Base URL:** `https://docflow-backend-1081873675658.asia-south1.run.app`

---

## Authentication

Both endpoints below require an API key. Send it on **every** request as a header called `df-api-key`.

**Your API Key:** `df_1ed61b2d333f1033bec3a27012221271363e67d6f9e93e1a`

Treat this key like a password — anyone who has it can read and update your GRN data. Don't share it outside your dev team, and don't commit it to a public repository. If it's ever exposed, let us know and we'll issue a new one and disable this one.

| Header | Required | Example |
|---|---|---|
| `df-api-key` | Yes | `df_1ed61b2d333f1033bec3a27012221271363e67d6f9e93e1a` |

A request without this header, or with an incorrect key, gets back:

```json
{ "error": "Missing df-api-key header" }
```

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

**Endpoint:** `GET https://docflow-backend-1081873675658.asia-south1.run.app/api/public/grn`

**Method:** `GET`

**Headers:**

| Header | Required | Example |
|---|---|---|
| `df-api-key` | Yes | `df_1ed61b2d333f1033bec3a27012221271363e67d6f9e93e1a` |

**Query parameters:**

| Parameter | Required | Example | Description |
|---|---|---|---|
| `date` | Yes | `2026-07-28` | Fetches every GRN record created on this date. Format: `YYYY-MM-DD`. |
| `grnStatus` | No | `DISPATCHED` | Narrows the results to only records currently set to this status. Leave it out to get every record for that date regardless of status. |

**Example — get everything from a specific date:**

```bash
curl --location 'https://docflow-backend-1081873675658.asia-south1.run.app/api/public/grn?date=2026-07-28' \
--header 'df-api-key: df_1ed61b2d333f1033bec3a27012221271363e67d6f9e93e1a'
```

**Example — get only records from that date with a specific status already set:**

```bash
curl --location 'https://docflow-backend-1081873675658.asia-south1.run.app/api/public/grn?date=2026-07-28&grnStatus=DISPATCHED' \
--header 'df-api-key: df_1ed61b2d333f1033bec3a27012221271363e67d6f9e93e1a'
```

**Response** — a list of matching records. The field names below are exactly what you'll receive; the values are made up.

```json
{
  "items": [
    {
      "id": "68f4a1b2c3d4e5f678901234",
      "documentId": "68f4a1b2c3d4e5f678904321",
      "title": "sample-invoice.pdf",
      "fileUrl": "https://storage.googleapis.com/<bucket>/<folder>/sample-invoice.pdf",
      "invoiceNo": "INV/001/2026-27",
      "invoiceDate": "15-07-2026",
      "status": "awaiting",
      "grnStatus": null,
      "createdAt": "07-08-2026",
      "match": true,

      "grnItems": [
        { "description": "Sample Product A Batch : 100001", "quantity": 200, "unit": "Mtr" },
        { "description": "Sample Product B Batch : 100002", "quantity": 150, "unit": "Mtr" }
      ],

      "invoice": {
        "invoiceNo": "INV/001/2026-27",
        "invoiceDate": "15-07-2026",
        "sellerName": "Example Seller Pvt. Ltd.",
        "sellerGstin": "24AAAAA0000A1Z5",
        "buyerName": "Example Buyer LLP",
        "buyerGstin": "24BBBBB1111B1Z5",
        "taxableValue": 17500,
        "cgstRate": "2.50%",
        "cgstAmount": 437.5,
        "sgstRate": "2.50%",
        "sgstAmount": 437.5,
        "igstRate": "",
        "igstAmount": 0,
        "roundOff": 0,
        "grandTotal": 18375,

        "pan_number": "AAAAA0000A",
        "hsn_code": "12345678",
        "bank_details": "Bank Name : Example Bank A/c No. : 000000000000 Branch & IFS Code : Example Branch & EXMP0000000",
        "payment_terms": "SAME DAY - NETT PAYMENT",
        "mode_terms_of_payment": "SAME DAY",
        "delivery_note": "INV/001/2026-27",
        "delivery_note_date": "15-Jul-26",
        "transport_dispatch_details": "Dispatched through EXAMPLE TRANSPORT Dispatch Doc No. ORDER NO. 100",
        "other_references": "Example Contact Name",
        "e_way_bill": "",
        "purchase_order_po_number": "",
        "sales_order": "",
        "o_a_no": "",
        "o_a_date": "",
        "d_c_date": "",
        "date_time_of_issue": "",
        "import_export_code_iec": "",
        "loase_holder_code": "",

        "invoiceItems": [
          { "description": "Sample Product A Batch : 100001", "hsn": "12345678", "qty": 200, "unit": "Mtr", "rate": 50, "amount": 10000, "mismatch": false },
          { "description": "Sample Product B Batch : 100002", "hsn": "12345678", "qty": 150, "unit": "Mtr", "rate": 50, "amount": 7500, "mismatch": false }
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
- `grnItems` — what was **actually received** and counted by our staff.
- `invoice.invoiceItems` — what the **invoice said was shipped**. Same order as `grnItems`, one entry per line, each with its own `mismatch` flag so you can see exactly which line disagrees.
- **Extra invoice fields** (`pan_number`, `bank_details`, `delivery_note`, `e_way_bill`, `transport_dispatch_details`, …) — anything printed on the document that has no fixed field of its own sits directly on the `invoice` object, alongside the standard fields. The key is the printed label, lowercased with underscores: "Ack No." becomes `ack_no`, "Company's PAN" becomes `companys_pan`.

  An empty string means the label was printed on the document but had no value against it. A field the document didn't mention at all is simply absent.

  **These keys vary from invoice to invoice**, because they come from what that particular document actually printed. Read them defensively — check whether a key is present, don't assume it always is. Older records may carry none at all. If there's a field you need on *every* record, tell us and we'll add it to the extraction settings, which pins it to a fixed key.
- `grnStatus` — currently whatever your system last set it to (see Endpoint 2), or empty if you haven't set it yet.
- `total` — how many records matched your date (and status, if you filtered by one).

---

## Endpoint 2 — Update the status on a GRN record

Once your system has processed a record (from Endpoint 1), use this to write your own status back onto it.

**Endpoint:** `PATCH https://docflow-backend-1081873675658.asia-south1.run.app/api/public/grn/{id}`

Replace `{id}` with the `id` value from the record you got back from Endpoint 1.

**Method:** `PATCH`

**Headers:**

| Header | Required | Example |
|---|---|---|
| `df-api-key` | Yes | `df_1ed61b2d333f1033bec3a27012221271363e67d6f9e93e1a` |
| `Content-Type` | Yes | `application/json` |

**Body** (JSON):

| Field | Required | Example | Description |
|---|---|---|---|
| `grnStatus` | Yes | `"DISPATCHED"` | Any text value you want. There's no fixed list — whatever your system calls this stage is what gets stored. |

**Example:**

```bash
curl --location --request PATCH 'https://docflow-backend-1081873675658.asia-south1.run.app/api/public/grn/68f4a1b2c3d4e5f678901234' \
--header 'df-api-key: df_1ed61b2d333f1033bec3a27012221271363e67d6f9e93e1a' \
--header 'Content-Type: application/json' \
--data '{"grnStatus": "DISPATCHED"}'
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
| `df-api-key` header missing or incorrect | Authentication error — the request never reaches your data. |
| `grnStatus` left blank or missing from the request | An error response — this field can't be empty. |
| The `id` in the URL doesn't match any GRN record | "Not found" error. |

---

## Quick summary for your dev team

1. Include the `df-api-key` header (see **Authentication** above) on every request to either endpoint.
2. Call **Endpoint 1** with a date to pull that day's GRN records — each one already includes the invoice, the received items, the document link, and a match flag, so no extra lookups are needed.
3. Once your system has done whatever it needs to with a record, call **Endpoint 2** with that record's `id` to write your own status back onto it.
4. Calling Endpoint 1 again later — optionally with `&grnStatus=...` — lets you check which records you've already marked, versus which are still pending.
