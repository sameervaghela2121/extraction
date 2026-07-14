alt="Document Extraction Portal — Module & API Analysis"

# Context

The user has a single-file HTML/JS prototype at `Document Extraction Portal/Document Portal.dc.html` (a design-tool export — "DocFlow" branding) that needs to be rebuilt as a real application: React in `frontend/`, Node/Express + MongoDB in `backend/`. Both directories are currently empty (greenfield).

The prototype has **no real backend** — all data is a hardcoded in-memory array, and "role" (Staff/Admin) is just a UI toggle, not real auth. So the module/API list below is inferred from the UI (forms, tables, buttons, nav) plus the architecture decisions confirmed with the user:

- **Auth:** real JWT-based email/password auth (login, invite flow, roles) — the prototype's role-toggle must become real RBAC.
- **File storage:** an external file-upload API will be provided/shared later — our backend does not implement its own storage layer, it integrates with that external API (upload happens through it; our DB stores the resulting file reference/metadata).
- **OCR/extraction engine:** already exists elsewhere — our backend integrates with that extraction API rather than building OCR. Our job is to trigger it, receive results, and persist them.
- **Tenancy:** single-tenant (matches the prototype — one shared org, users, and settings pool).

This document is analysis only — **no implementation** has been started, per the user's request.

---

# Modules (Frontend pages / Backend feature areas)

Both frontend and backend should be organized around these 6 modules, mirroring the prototype's sidebar nav:

1. **Auth & Session** — login, JWT issuance/refresh, invite-acceptance, logout, current-user profile. (New — not in prototype, which had no login screen.)
2. **Upload & Scan** — 3 intake channels: file upload, mobile scan-session, email-in.
3. **Documents** — the extraction queue/table, document detail/verify view, bulk actions, activity/audit log.
4. **Extraction Settings** (admin only) — per-document-type field configuration (enable/disable built-in fields, add/remove custom fields).
5. **User Management** (admin only) — invite users, edit role/status, list users with doc counts.
6. **Export** — filterable export builder (columns, format, date range, status), export generation, export history.

Cross-cutting: **Activity/Audit Log** (attached to documents), **Toast/notification** feedback (frontend-only), **RBAC middleware** (Staff vs Admin gating, Staff scoped to own documents).

---

# Data Entities (MongoDB collections)

1. **User**
   `_id, name, email, passwordHash, role (staff|admin), status (invited|active|suspended), invitedAt, createdAt, updatedAt`

2. **Document**
   `_id, type (invoice|expense|bank_statement), title, status (pending|verified|archived), source (upload|scan|email), ownerId (ref User), uploadedAt, confidence (high|medium|low), fileRef (id/URL from external upload API), extractedFields: [{ key, value, confidence, isCustom }], verifiedAt, verifiedBy`

3. **FieldDefinition** (per document type — drives both extraction config and export columns)
   `_id, docType, key, label, description, required (bool), enabled (bool), isCustom (bool), defaultOff (bool), order`

4. **ActivityLog**
   `_id, documentId (ref), actor (ref User or "System"), action, timestamp, meta`

5. **ScanSession** (mobile scan-to-upload)
   `_id, token, expiresAt, userId (ref), status (pending|capturing|uploaded|expired), resultDocumentId`

6. **ExportJob** (export history)
   `_id, filename, format (csv|xlsx), docType, filters: { status, dateFrom, dateTo }, columns: [{ key, label }], rowCount, generatedBy (ref User), generatedAt`

7. **Invite** (can be embedded in User via `status: invited`, or separate if invite tokens are needed)
   `_id, email, name, role, token, expiresAt, acceptedAt`

---

# API Endpoints by Module

### 1. Auth & Session
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Email/password login → JWT access + refresh token |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/logout` | Invalidate refresh token |
| POST | `/api/auth/invite/:token/accept` | Accept invite, set password, activate account |
| GET | `/api/auth/me` | Current logged-in user profile (name, role, avatar initials) |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password via token |

### 2. Upload & Scan
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/documents/upload` | Register a document after file is uploaded via external upload API (docType, fileRef, source=upload) → creates Document, triggers extraction job |
| POST | `/api/scan-sessions` | Create a scan session (returns token + expiring link, 10 min TTL) |
| GET | `/api/scan-sessions/:token` | Mobile client fetches session state (for capture flow) |
| POST | `/api/scan-sessions/:token/pages` | Add a captured page to the session |
| POST | `/api/scan-sessions/:token/complete` | Finalize session → assembles pages into one Document (source=scan) |
| GET | `/api/inbound-email-address` | Get the current user's/org's unique inbound scan email address |
| (webhook) POST | `/api/webhooks/inbound-email` | Receiver for inbound email provider (e.g. SendGrid/Mailgun) → creates Document (source=email) |
| POST | `/api/webhooks/extraction-result` | Callback from external extraction/OCR API delivering extracted fields + confidence for a Document |

### 3. Documents
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/documents` | List with query params: `type, status, search, showArchived, sort, page` — scoped to own docs for Staff, all docs for Admin |
| GET | `/api/documents/:id` | Document detail incl. extractedFields, activity log, fileRef for preview |
| PATCH | `/api/documents/:id/fields` | Update one or more extracted field values (manual correction) |
| POST | `/api/documents/:id/verify` | Approve & verify a document |
| POST | `/api/documents/:id/reject` | Send back for re-scan |
| POST | `/api/documents/:id/archive` | Archive a document |
| POST | `/api/documents/:id/restore` | Restore an archived document |
| POST | `/api/documents/bulk/verify` | Bulk approve & verify (array of ids) |
| POST | `/api/documents/bulk/reject` | Bulk send-back |
| POST | `/api/documents/bulk/archive` | Bulk archive |
| GET | `/api/documents/:id/activity` | Activity/audit log for a document (also embeddable in the detail response) |

### 4. Extraction Settings (admin only)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/field-definitions/:docType` | List field definitions for a document type (built-in + custom, enabled state) |
| PATCH | `/api/field-definitions/:docType/:fieldKey` | Toggle enabled/disabled for a built-in field |
| POST | `/api/field-definitions/:docType` | Add a custom field (title + description) |
| DELETE | `/api/field-definitions/:docType/:fieldKey` | Remove a custom field |

### 5. User Management (admin only)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users` | List users with role, status, computed docCount |
| POST | `/api/users/invite` | Invite a new user (name, email, role) → creates User(status=invited) + sends invite email |
| PATCH | `/api/users/:id` | Edit role and/or status (Staff/Admin, Active/Suspended) |
| DELETE | `/api/users/:id` | Remove/deactivate a user (if needed beyond suspend) |

### 6. Export
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/export/preview-count` | Given filters (docType, status, dateFrom, dateTo), return matching document count live |
| POST | `/api/export` | Generate export file (CSV/XLSX) server-side given docType, columns (with renamed titles), status filter, date range → returns file/download link, persists ExportJob |
| GET | `/api/export/history` | List past export jobs (filename, format, rowCount, generatedAt) |
| GET | `/api/export/:id/download` | Re-download a previously generated export file |

---

# Notes / Open Integration Points

- **External upload API**: once shared, the Upload module's `POST /api/documents/upload` will need its request shape adjusted to match whatever `fileRef` that API returns (id, signed URL, etc.) — currently modeled generically.
- **External extraction API**: `POST /api/webhooks/extraction-result` is a placeholder contract; exact payload shape depends on the extraction API's response format once shared. Alternatively it may be a synchronous call from our backend rather than a webhook — confirm when that API is provided.
- **Email-in channel**: requires picking an inbound email provider (SendGrid Inbound Parse, Mailgun Routes, etc.) — not yet decided, flagged as a dependency.
- **PDF/image viewer**: the prototype only shows a placeholder image slot for the document preview — real multi-page PDF viewing/zoom needs to be designed in the React frontend (not just an API concern).
- **No dashboard/analytics screen** exists in the prototype — none included above unless the user wants one added.
