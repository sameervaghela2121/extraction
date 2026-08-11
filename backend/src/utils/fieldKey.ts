/**
 * Rewrites the keys of Gemini's `other_fields` bag into stable, code-addressable keys:
 * lowercase, words joined by underscores. "Ack No." -> "ack_no".
 *
 * The raw keys are whatever label was printed on that particular document, so they carry
 * spaces, dots, ampersands and apostrophes. Values are passed through untouched.
 *
 * Same rule as fieldDefinitions.service.addCustom() uses to key an admin-defined field —
 * deliberately so. A custom field defined in Extraction Settings comes back inside
 * `other_fields` under exactly that key (see build_custom_fields_prompt in
 * invoice-generator-backend/api/main.py), and must survive this unchanged.
 *
 * Two labels can normalise to the same key ("Ack No." and "Ack No"); first one wins, so
 * the result doesn't depend on iteration order. A label that is entirely punctuation
 * normalises to nothing and keeps its original text — an ugly key beats a dropped value.
 *
 * ponytail: label-derived keys are only as stable as the printed labels. For a field an
 * integration MUST rely on, define it in Extraction Settings — those are prompted for by
 * key and arrive already stable.
 */
export function toFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "") // dropped, not split on: "Company's PAN" -> companys_pan, not company_s_pan
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, ""); // "Ack No." would otherwise end in a stray "_"
}

export function normaliseOtherFields(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!raw) return undefined;

  return Object.entries(raw).reduce<Record<string, unknown>>(
    (acc, [label, value]) => {
      const key = toFieldKey(label) || label;
      return key in acc ? acc : { ...acc, [key]: value };
    },
    {},
  );
}

/** `npx tsx src/utils/fieldKey.ts` — asserts the cases described above actually hold. */
function selfCheck(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`selfCheck failed: ${msg}`);
  };

  assert(toFieldKey("IRN") === "irn", "acronym");
  assert(toFieldKey("Ack No.") === "ack_no", "trailing punctuation");
  assert(toFieldKey("Company's PAN") === "companys_pan", "apostrophe");
  assert(toFieldKey("Branch & IFS Code") === "branch_ifs_code", "ampersand");
  assert(toFieldKey("A/c No.") === "a_c_no", "slash");
  assert(toFieldKey("GST(RCM)") === "gst_rcm", "parentheses");
  assert(toFieldKey("vehicle_no") === "vehicle_no", "custom field key unchanged");

  const out = normaliseOtherFields({ "Ack No.": "1", "Place of Supply": "Gujarat" })!;
  assert(out.ack_no === "1" && out.place_of_supply === "Gujarat", "keys rewritten");
  assert(normaliseOtherFields({ "Ack No.": "first", "Ack No": "second" })!.ack_no === "first", "collision");
  assert(normaliseOtherFields({ "!!!": "kept" })!["!!!"] === "kept", "unsluggable label");
  assert(normaliseOtherFields(undefined) === undefined, "absent bag");

  console.log("fieldKey selfCheck OK");
}

if (require.main === module) selfCheck();
