// store_manager and godown_operator exist on the backend for the mobile app. The web UI
// never offers them as a choice — they're here only so the auth pages can recognise one
// and stay put. godown_supervisor uses both surfaces, so it does sign in here.
//
// super_admin is never offered as a choice either — the backend only ever hands this role
// out via a direct Mongo write (see USER_ROLES in the backend's User.model.ts). It's in
// this union only so pages that already have one (nav, the users table) can render it.
export type UserRole =
  | "staff"
  | "admin"
  | "store_manager"
  | "godown_supervisor"
  | "godown_operator"
  | "super_admin";

/** Roles whose account is app-only — the web login sets the password but won't sign them in. */
export function isMobileOnlyRole(role: UserRole): boolean {
  return role === "store_manager" || role === "godown_operator";
}
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

// ---- Royal Touche master data ----

export type MasterStatus = "active" | "inactive";

/** One row of the Royal Touche paper-codes sheet, embedded in its supplier. A paper needs
 *  at least one of the two codes; only papers with an RT code can be picked for a roll. */
export interface VendorPaper {
  royal_touche_code?: string;
  delta_code?: string;
  is_common?: boolean;
  supplier_code_number?: string;
  found_in?: string;
}

export interface Vendor {
  id: string;
  vendor_code: string;
  name: string;
  papers: VendorPaper[];
  contact: { person?: string; phone?: string; email?: string };
  address?: string;
  gst_number?: string;
  status: MasterStatus;
}

export interface GodownLocation {
  id: string;
  location_code: string;
  name: string;
  godown?: string;
  sort_order?: number;
  status: MasterStatus;
}

export interface RawMaterial {
  id: string;
  material_code: string;
  name: string;
  category?: string;
  gsm?: number;
  width_mm?: number;
  unit: string;
  reorder_level?: number;
  status: MasterStatus;
}

/** The envelope every paginated list endpoint returns. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Only the fields the barcode screen prints or filters on — a roll response carries
 *  photos, weights and refs the label has no use for. */
export interface MaterialRollListItem {
  id: string;
  roll_number: string;
  royal_touche_code?: string;
  batch_no?: string;
  gsm: number;
  width: number;
  unit: string;
  location: string;
  status: "IN_STOCK" | "ISSUED" | "CONSUMED";
}

/** A standard note an operator picks instead of typing — "Misprint", "Color variant". */
export interface Remark {
  id: string;
  remark_code: string;
  label: string;
  sort_order?: number;
  status: MasterStatus;
}

/** A saved run of blank labels. Only the recipe is stored — the codes are regenerated
 *  from prefix + date + range, so a batch is the same size whatever it printed. */
export interface BarcodeBatch {
  id: string;
  prefix: string;
  date: string;
  from_number: number;
  to_number: number;
  count: number;
  createdBy: string;
  createdAt: string;
}
