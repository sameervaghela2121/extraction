import { vendorsApi, locationsApi, materialTypesApi, remarksApi } from "../../api/masters.api";
import type { MasterStatus, VendorPaper } from "../../types";

/** What every master row has in common. The rest is read through the field spec, which is
 *  why the section component can be one component instead of three near-identical ones. */
export interface MasterRow {
  id: string;
  status: MasterStatus;
  papers?: VendorPaper[];
  [key: string]: unknown;
}

export interface MasterApi {
  list: () => Promise<MasterRow[]>;
  create: (body: Partial<MasterRow>) => Promise<MasterRow>;
  update: (id: string, body: Partial<MasterRow>) => Promise<MasterRow>;
  remove: (id: string) => Promise<unknown>;
}

export interface MasterField {
  name: string;
  label: string;
  type: "text" | "number";
  /** Required on create. Code fields are also the row's human identity. */
  required?: boolean;
  /** Shown as a table column. Everything else lives in the edit form only. */
  inList?: boolean;
}

export interface MasterSpec {
  /** Also the URL segment: /masters/<key>. */
  key: string;
  label: string;
  /** Sits under the page title, saying what this master is for. */
  subtitle: string;
  /** Singular, for button and modal titles ("Add vendor"). */
  noun: string;
  /** Plural, for the pager's count line ("40 material types"). Stated rather than derived
   *  from `key`: the key is a URL segment that outlives whatever the screen is called, so
   *  reading display text off it left the pager saying "raw materials" after the section
   *  had been renamed. */
  plural: string;
  api: MasterApi;
  fields: MasterField[];
  /** Vendors alone carry the embedded paper-codes sheet, which needs its own row editor. */
  hasPapers?: boolean;
}

// The typed clients are cast once here: the concrete row types (Vendor, GodownLocation,
// MaterialType) have no index signature, so they don't structurally satisfy MasterRow.
const asMasterApi = (api: unknown) => api as MasterApi;

export const VENDOR_SPEC: MasterSpec = {
  key: "vendors",
  label: "Vendors & papers",
  subtitle: "Suppliers and the Royal Touche paper codes they supply.",
  noun: "vendor",
  plural: "vendors",
  api: asMasterApi(vendorsApi),
  hasPapers: true,
  fields: [
    { name: "vendor_code", label: "Vendor code", type: "text", required: true, inList: true },
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    { name: "gst_number", label: "GST number", type: "text", inList: true },
    { name: "address", label: "Address", type: "text" },
  ],
};

export const LOCATION_SPEC: MasterSpec = {
  key: "locations",
  label: "Locations",
  subtitle: "Godown bays that fill the roll location picker.",
  noun: "location",
  plural: "locations",
  api: asMasterApi(locationsApi),
  fields: [
    { name: "location_code", label: "Location code", type: "text", required: true, inList: true },
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    { name: "godown", label: "Godown", type: "text", inList: true },
    { name: "sort_order", label: "Sort order", type: "number", inList: true },
  ],
};

export const MATERIAL_TYPE_SPEC: MasterSpec = {
  // `key` is the browser URL only — /masters/material-types. The API path behind it stays
  // /api/raw-materials (see masters.api.ts): the backend resource was not renamed, and the
  // mobile app reads the same endpoint.
  key: "material-types",
  label: "Material types",
  subtitle: "The material types a roll can be booked against: codes, units and reorder levels.",
  noun: "material type",
  plural: "material types",
  api: asMasterApi(materialTypesApi),
  fields: [
    { name: "material_code", label: "Material code", type: "text", required: true, inList: true },
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    { name: "category", label: "Category", type: "text", inList: true },
    { name: "unit", label: "Unit", type: "text", required: true, inList: true },
    { name: "gsm", label: "GSM", type: "number" },
    { name: "width_mm", label: "Width (mm)", type: "number" },
    { name: "reorder_level", label: "Reorder level", type: "number" },
  ],
};

export const REMARK_SPEC: MasterSpec = {
  key: "remarks",
  label: "Remarks",
  subtitle: "Standard notes an operator picks when a roll or a movement needs one.",
  noun: "remark",
  plural: "remarks",
  api: asMasterApi(remarksApi),
  fields: [
    { name: "remark_code", label: "Remark code", type: "text", required: true, inList: true },
    { name: "label", label: "Label", type: "text", required: true, inList: true },
    { name: "sort_order", label: "Sort order", type: "number", inList: true },
  ],
};

/** Sidebar order, and what /masters/:section resolves against. */
export const MASTER_SPECS: MasterSpec[] = [
  VENDOR_SPEC,
  LOCATION_SPEC,
  MATERIAL_TYPE_SPEC,
  REMARK_SPEC,
];
