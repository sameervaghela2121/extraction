/**
 * The identity of a material specification, as one string that can carry a unique index.
 *
 * Why computed rather than a compound index on the four fields: ITC base paper has no
 * design code at all (the label reads only "WHITE BASE PAPER 50 RL" plus gsm and width),
 * while Schattdecor and Interprint always print one. A compound unique index treats
 * repeated nulls as distinct in some engines and identical in others; collapsing to a
 * single normalised string makes "no design code" an explicit empty segment instead.
 *
 *   SCHATT|4000432-14-000|1250|70
 *   ITC||1240|50
 *
 * Width is always mm and gsm always g/m² — suppliers print cm, mm and "G/M2"
 * interchangeably, so callers must normalise before they get here.
 */
export function buildMaterialKey(params: {
  supplierCode: string;
  designCode?: string | null;
  widthMm: number;
  gsm: number;
}): string {
  const supplier = params.supplierCode.trim().toUpperCase();
  // Case and surrounding whitespace vary between the label and manual entry; the inner
  // punctuation of a design code is significant and left alone.
  const design = (params.designCode ?? "").trim().toUpperCase();
  return `${supplier}|${design}|${Math.round(params.widthMm)}|${params.gsm}`;
}
