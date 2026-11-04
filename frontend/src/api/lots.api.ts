import { call, fileObjectUrl, uploadFile } from "./client";
import type { Lot, LotDocumentType, Paginated } from "../types";

const M = "royal_touche.api.portal_lots.";

/** The server sends the photo's path; the portal reads it with the login token and hands the
 *  page a local address in document_photo_url, where the old server put a signed URL. */
async function withPhotoUrl(lot: Lot): Promise<Lot> {
  return { ...lot, document_photo_url: await fileObjectUrl(lot.document_photo_path) };
}

/** Lots: one per delivery, known by its challan or invoice. Created here or on the tablet. */
export const lotsApi = {
  list: (params: { q?: string; page?: number; pageSize?: number }) =>
    call<Paginated<Lot>>(`${M}list_lots`, params),

  /** Carries the document photo URL, which the list leaves out. */
  get: (id: string) => call<Lot>(`${M}get_lot`, { id }).then(withPhotoUrl),

  create: (body: { document_type: LotDocumentType; document_no: string; document_photo_path?: string }) =>
    call<Lot>(`${M}create_lot`, body, "POST").then(withPhotoUrl),

  /** The challan / invoice photo is uploaded as a private file; the returned path is what
   *  create takes. */
  uploadDocumentPhoto: (file: File) => uploadFile(file),
};
