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
  /** Puts a click-to-sort control on this column's header. Opt-in per field rather than on
   *  by default: a row of arrows across every header is noise when only one column is
   *  worth reordering by. Only meaningful alongside `inList`. */
  sortable?: boolean;
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
}

// The typed clients are cast once here: the concrete row types (Vendor, GodownLocation,
// MaterialType) have no index signature, so they don't structurally satisfy MasterRow.
const asMasterApi = (api: unknown) => api as MasterApi;

export const VENDOR_SPEC: MasterSpec = {
  key: "vendors",
  label: "Vendors",
  // The paper codes moved to their own screen (Raw material) — this page is suppliers only.
  subtitle: "The suppliers rolls are received from.",
  noun: "vendor",
  plural: "vendors",
  api: asMasterApi(vendorsApi),
  fields: [
    { name: "vendor_code", label: "Vendor code", type: "text", required: true, inList: true, sortable: true },
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
    { name: "location_code", label: "Location code", type: "text", required: true, inList: true, sortable: true },
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    // No inList: still edited on the form, just not a column.
    { name: "godown", label: "Godown", type: "text" },
    { name: "sort_order", label: "Sort order", type: "number", inList: true },
  ],
};

export const MATERIAL_TYPE_SPEC: MasterSpec = {
  // `key` is the browser URL only — /masters/material-types. The API path behind it stays
  // /api/raw-materials (see masters.api.ts): the backend resource was not renamed, and the
  // mobile app reads the same endpoint.
  key: "material-types",
  label: "Material types",
  subtitle: "The material types a roll can be booked against.",
  noun: "material type",
  plural: "material types",
  api: asMasterApi(materialTypesApi),
  fields: [
    { name: "material_code", label: "Material code", type: "text", required: true, inList: true, sortable: true },
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    // No inList: both stay on the form but are off the table. `unit` has to stay editable —
    // createRawMaterialSchema requires it, so a create that omitted it would be a 400.
    { name: "category", label: "Category", type: "text" },
    { name: "unit", label: "Unit", type: "text", required: true },
    // Same as the locations master: the picker should follow how the godown thinks about
    // its materials, which is rarely alphabetical. Blank sorts last.
    { name: "sort_order", label: "Sort order", type: "number", inList: true },
    // gsm, width_mm and reorder_level are off the form entirely. They are optional on the
    // API, and the backend's PATCH skips fields a body omits, so existing values survive an
    // edit here rather than being blanked. See the note in MasterSection.buildBody.
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
    { name: "remark_code", label: "Remark code", type: "text", required: true, inList: true, sortable: true },
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
