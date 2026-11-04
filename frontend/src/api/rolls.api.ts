import { call, fileObjectUrl, uploadFile } from "./client";
import type { MaterialRoll, MaterialRollListItem, Paginated, VendorPaper } from "../types";

const M = "royal_touche.api.portal_rolls.";

/** The roll's photo paths and the link fields they fill. The server returns the paths; private
 *  files need the login token, so the links are made here (see fileObjectUrl). */
const PHOTOS = [
  ["tag_photo_path", "tag_photo_url"],
  ["stitched_barcode_photo_path", "stitched_barcode_photo_url"],
  ["side1_photo_path", "side1_photo_url"],
  ["side2_photo_path", "side2_photo_url"],
] as const;

type WithPhotoPaths = MaterialRoll & Partial<Record<(typeof PHOTOS)[number][0], string>>;

/** One roll with its photo links filled. Only for single-roll answers: a page of rolls would
 *  download every photo on it, and no list screen shows them. */
async function withPhotos(roll: MaterialRoll): Promise<MaterialRoll> {
  const r = roll as WithPhotoPaths;
  const urls = await Promise.all(PHOTOS.map(([path]) => fileObjectUrl(r[path])));
  const out = { ...roll };
  PHOTOS.forEach(([, url], i) => {
    out[url] = urls[i];
  });
  return out;
}

/** Unlike the masters, this endpoint pages server-side — rolls grow without bound, so the
 *  list is never read whole and `q` is a real query rather than an in-memory filter. */
export const rollsApi = {
  list: (params: { q?: string; page?: number; pageSize?: number }) =>
    call<Paginated<MaterialRollListItem>>(`${M}list`, params),

  /** The full roll — the list item is deliberately narrower than this. */
  listFull: (body: {
    q?: string;
    sort?: "roll_number" | "date";
    order?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }) => call<Paginated<MaterialRoll>>(`${M}search`, body),

  /** By id, roll number or barcode. */
  get: (id: string) => call<MaterialRoll>(`${M}get`, { id }).then(withPhotos),

  /** Registers a roll; the server writes its IN movement. Refused without a lot. */
  create: (body: {
    lot_id: string;
    barcode: string;
    roll_number: string;
    material_id: string;
    weight: number;
    date: string;
    location: string;
    vendor_id: string;
    papers: VendorPaper[];
    gsm: number;
    width: number;
    side1_photo_path?: string;
    side2_photo_path?: string;
  }) => call<MaterialRoll>(`${M}create`, body, "POST").then(withPhotos),

  /** Uploads a roll photo as a private file; the returned path is what create takes. */
  uploadPhoto: (file: File) => uploadFile(file),

  /** Never send remaining_weight, weight, status or client_id — all are refused with a 400.
   *  A stock figure changes through a movement, which leaves a ledger row behind it. */
  update: (id: string, body: Partial<MaterialRoll> & { material_id?: string }) =>
    call<MaterialRoll>(`${M}update`, { ...body, id }, "POST").then(withPhotos),

  /** Soft: the roll and its movements are kept, marked deleted. */
  remove: (id: string) => call<{ id: string; deleted: boolean }>(`${M}remove`, { id }, "POST"),
};
