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

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  docCount: number;
}
