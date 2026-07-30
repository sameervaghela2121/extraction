export type UserRole = "staff" | "admin";
export type UserStatus = "invited" | "active" | "suspended";
export type DocumentSource = "upload" | "scan" | "email";
export type DocumentStatus = "pending" | "verified" | "archived";
export type Confidence = "high" | "needs_attention";

export interface AuthUser {
  userId: string;
  role: UserRole;
  name: string;
  email: string;
}

export interface AuthResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export interface DocumentListItem {
  id: string;
  title: string;
  status: DocumentStatus;
  source: DocumentSource;
  uploadedAt: string;
  owner: string;
  amount: number | null;
  vendor: string | null;
  confidence: Confidence;
  extractionStatus: string;
}

export interface DocumentListResponse {
  items: DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ExtractedField {
  key: string;
  value: string | number | null;
  isCustom: boolean;
}

export interface ActivityEntry {
  actor: string;
  action: string;
  timestamp: string;
}

// One uploaded file can contain multiple invoices back-to-back — each gets its own
// block (fields + line items) instead of collapsing to just the first one.
export interface InvoiceBlock {
  invoiceId: string;
  validation?: string;
  confidence: Confidence;
  fields: ExtractedField[];
  items: InvoiceItem[];
}

export interface DocumentDetail {
  id: string;
  title: string;
  status: DocumentStatus;
  source: DocumentSource;
  uploadedAt: string;
  verifiedAt?: string;
  fileId: string;
  extractionStatus: string;
  extractionError?: string;
  invoices: InvoiceBlock[];
  activity: ActivityEntry[];
}

// Different PDFs extract different item shapes, so this stays a loose record —
// the table on the Detail page derives its columns from whatever keys are present
// instead of assuming a fixed set like description/hsn/qty.
export type InvoiceItem = Record<string, string | number | null>;

export interface FieldDefinition {
  _id: string;
  key: string;
  label: string;
  description?: string;
  required: boolean;
  enabled: boolean;
  isCustom: boolean;
  order: number;
}

// ---- GRN ----
// A GRN only records what arrived: the invoice identity plus each line's quantity.
export interface GrnItem {
  description: string;
  // null, not 0 — a blank box means "not counted", not "none received".
  quantity: number | null;
  // Read-only, from the original extraction — not something a GRN records or edits.
  // Absent when the invoice had none, or on a GRN saved before this existed.
  unit?: string;
}

export interface GrnInvoice {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  items: GrnItem[];
  saved: boolean;
}

export interface GrnDraftDocument {
  documentId: string;
  title: string;
  extractionStatus: string;
  extractionError?: string;
  invoices: GrnInvoice[];
}

export interface GrnDraft {
  documents: GrnDraftDocument[];
}

/** "awaiting" = not yet reviewed. Switchable in both directions. */
export type GrnStatus = "awaiting" | "approved" | "rejected";

/** "match"/"mismatch" = received quantities were/weren't identical to the invoice's,
 *  line for line. "unknown" = nothing to compare (old GRN, no items, or the invoice
 *  never had a readable quantity) — render as a neutral dot, not a false green/red. */
export type GrnMatchStatus = "match" | "mismatch" | "unknown";

export interface GrnListItem {
  id: string;
  invoiceNo: string;
  /** Already DD-MM-YYYY — the backend normalises it. Don't wrap it in `new Date()`. */
  invoiceDate: string;
  itemCount: number;
  createdBy: string;
  /** Already DD-MM-YYYY, not ISO. Render as-is. */
  createdAt: string;
  status: GrnStatus;
  /** Received quantities vs. the original invoice, computed server-side. */
  match: GrnMatchStatus;
}

export interface GrnListResponse {
  items: GrnListItem[];
  total: number;
  page: number;
  totalPages: number;
}

/** The purchase invoice a GRN was built from — the extraction snapshot, for the
 *  side-by-side comparison panel. Undefined for GRNs saved before this existed. */
export interface GrnSourceInvoice {
  invoiceNo?: string;
  /** Already DD-MM-YYYY, not ISO. Render as-is. */
  invoiceDate?: string;
  sellerName?: string;
  sellerGstin?: string;
  buyerName?: string;
  buyerGstin?: string;
  taxableValue?: number;
  cgstRate?: string;
  cgstAmount?: number;
  sgstRate?: string;
  sgstAmount?: number;
  igstRate?: string;
  igstAmount?: number;
  roundOff?: number;
  grandTotal?: number;
  /** Columns vary by invoice layout — same reason `Document.invoices[].items` is untyped. */
  items: Array<Record<string, unknown>>;
}

export interface GrnDetail {
  id: string;
  /** The uploaded invoice this GRN came from — what the preview pane loads. */
  documentId: string;
  title: string;
  invoiceNo: string;
  /** All three dates arrive as DD-MM-YYYY strings, not ISO. Render as-is. */
  invoiceDate: string;
  items: GrnItem[];
  status: GrnStatus;
  createdAt: string;
  decidedAt?: string;
  invoice?: GrnSourceInvoice;
}

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  docCount: number;
}
