import type { ZodError, ZodIssue } from "zod";

/**
 * Turns Zod's issue list into something an operator can act on.
 *
 * Zod's defaults describe the schema ("Expected number, received nan"), not the mistake.
 * The person holding the roll needs "Returned weight is required" — and the Android
 * developer needs to know which field, which is what `fields` carries.
 */

/** Field names as they appear on the app's screens, not as they appear in the schema. */
const FIELD_LABELS: Record<string, string> = {
  barcodeId: "Barcode",
  materialId: "Material",
  clientId: "Client",
  batchId: "Batch",
  locationId: "Location",
  supplierId: "Supplier",
  status: "Status",
  reason: "Reason",
  name: "Name",
  query: "Search text",
  search: "Search text",
  returnedWeightKg: "Returned weight",
  currentWeightKg: "Weight",
  receivedWeightKg: "Received weight",
  grossWeightKg: "Gross weight",
  netWeightKg: "Net weight",
  chargeableWeightKg: "Chargeable weight",
  lengthM: "Length",
  diameterMm: "Diameter",
  areaM2: "Area",
  splices: "Splices",
  employeeId: "Employee ID",
  password: "Password",
};

/** grossWeightKg -> "Gross weight". Unit and id suffixes are noise on a screen. */
function humanise(field: string): string {
  const words = field
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s(Kg|Mm|M2|M|Id)$/i, "")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function labelFor(issue: ZodIssue): string {
  const field = issue.path[issue.path.length - 1];
  if (typeof field !== "string") return "Value";
  return FIELD_LABELS[field] ?? humanise(field);
}

function messageFor(issue: ZodIssue): string {
  const label = labelFor(issue);

  switch (issue.code) {
    case "invalid_type":
      // Zod reports a missing field as undefined, and our numeric preprocess keeps it that
      // way rather than coercing it to NaN — so this really does mean "you didn't send it".
      return issue.received === "undefined"
        ? `${label} is required`
        : `${label} must be a ${issue.expected}`;

    case "invalid_union_discriminator":
      return `${label} must be one of: ${issue.options.join(", ")}`;

    case "too_small":
      return issue.type === "string"
        ? `${label} is too short`
        : `${label} must be at least ${issue.minimum}`;

    case "too_big":
      return issue.type === "string"
        ? `${label} is too long`
        : `${label} must be at most ${issue.maximum}`;

    default:
      // Schema-supplied messages ("Invalid barcode", "A reason is required") are already
      // written for a human — keep them rather than paraphrasing.
      return issue.message;
  }
}

export type ReadableValidationError = {
  message: string;
  fields: Record<string, string>;
};

export function toReadableValidationError(error: ZodError): ReadableValidationError {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    // First issue per field wins: later ones are usually consequences of the same mistake.
    if (!(key in fields)) fields[key] = messageFor(issue);
  }

  const messages = Object.values(fields);
  return {
    // One sentence for a toast; the full list stays in `fields` for inline highlighting.
    message: messages.length === 1 ? messages[0] : messages.join(". "),
    fields,
  };
}
