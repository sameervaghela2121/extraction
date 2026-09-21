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
  reorder: (ids: string[]) => Promise<MasterRow[]>;
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
  /** Never an input in the Add/Edit form — for a value the backend owns (sort_order:
   *  assigned on create, changed only by dragging a row). Pair with `inList` to still show
   *  it as a read-only column; without it the field is declared but never rendered. */
  readOnly?: boolean;
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
  /** Drag rows to set `sort_order` directly, instead of typing a number. Only on for masters
   *  whose picker order is meant to follow something other than the alphabet (a physical
   *  walk through the godown, the common remarks first) — vendors has no such need. */
  reorderable?: boolean;
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
  reorderable: true,
  fields: [
    { name: "location_code", label: "Location code", type: "text", required: true, inList: true, sortable: true },
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    // No inList: still edited on the form, just not a column.
    { name: "godown", label: "Godown", type: "text" },
    // Declared but never rendered: no column (the drag handle is the affordance) and no form
    // input (it is assigned on create and changed only by dragging). It stays in `fields` so
    // the sort comparator can still see type: "number" — see MasterSection's sort lookup.
    { name: "sort_order", label: "Sort order", type: "number", readOnly: true },
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
  reorderable: true,
  fields: [
    { name: "material_code", label: "Material code", type: "text", required: true, inList: true, sortable: true },
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    // Same as the locations master: the picker should follow how the godown thinks about
    // its materials, which is rarely alphabetical. Assigned on create and changed only by
    // dragging a row. Declared but never rendered — see the note on the locations master.
    { name: "sort_order", label: "Sort order", type: "number", readOnly: true },
    // category, unit, gsm, width_mm and reorder_level are all off the form. They are
    // optional on the API, and the backend's PATCH skips fields a body omits, so the values
    // already stored survive an edit here rather than being blanked. See the note in
    // MasterSection.buildBody.
    //
    // `unit` was removed alongside the others once it stopped being required: a roll takes
    // its unit from what the client sends at registration (defaulting to "kg"), never from
    // the material type, so a blank one here changes nothing downstream.
  ],
};

export const REMARK_SPEC: MasterSpec = {
  key: "remarks",
  label: "Remarks",
  subtitle: "Standard notes an operator picks when a roll or a movement needs one.",
  noun: "remark",
  plural: "remarks",
  api: asMasterApi(remarksApi),
  reorderable: true,
  fields: [
    { name: "remark_code", label: "Remark code", type: "text", required: true, inList: true, sortable: true },
    { name: "label", label: "Label", type: "text", required: true, inList: true },
    // Assigned on create and changed only by dragging a row — the common remarks belong at
    // the top, not typed in as a guessed number. Declared but never rendered.
    { name: "sort_order", label: "Sort order", type: "number", readOnly: true },
  ],
};

/** Sidebar order, and what /masters/:section resolves against. */
export const MASTER_SPECS: MasterSpec[] = [
  VENDOR_SPEC,
  LOCATION_SPEC,
  MATERIAL_TYPE_SPEC,
  REMARK_SPEC,
];
