import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Image as ImageIcon, Plus } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { lotsApi } from "../../api/lots.api";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Pager, { PAGE_SIZE } from "./Pager";
import type { Lot } from "../../types";

/**
 * Lots — one per delivery challan; the rolls of that delivery point at it. Created here or on
 * the tablet (offline, synced like a roll). The number ("Lot-12") is the server's, minted on
 * create, so it is never typed.
 */
export default function LotsPage() {
  const { notify } = useToast();
  const [lots, setLots] = useState<Lot[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [challanNo, setChallanNo] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The photo needs the detail response — the list does not sign one URL per row.
  const [viewing, setViewing] = useState<Lot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lotsApi.list({ q: search.trim() || undefined, page, pageSize: PAGE_SIZE });
      setLots(res.items);
      setTotal(res.total);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [search, page, notify]);

  // Typing settles before the request goes, and a new search starts from page 1.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => setPage(1), [search]);

  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const openCreate = () => {
    setChallanNo("");
    setPhoto(null);
    setCreating(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!challanNo.trim() || !photo) return;
    setSaving(true);
    try {
      const path = await lotsApi.uploadChallanPhoto(photo);
      const lot = await lotsApi.create({ challan_no: challanNo.trim(), challan_photo_path: path });
      notify(`${lot.lot_number} created for challan ${lot.challan_no}`);
      setCreating(false);
      setPage(1);
      await load();
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const openPhoto = async (lot: Lot) => {
    try {
      setViewing(await lotsApi.get(lot.id));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  return (
    <div className="list-page">
      <PageHeader
        title="Lots"
        subtitle="One lot per delivery challan. Rolls registered on the app can be linked to a lot."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> New lot
          </button>
        }
      />

      <div className="row gap-8" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Search by lot number or challan number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card list-page-scroll list-page-table-card" style={{ overflow: "hidden" }}>
        {loading ? (
          <Spinner />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Lot number</th>
                  <th>Challan number</th>
                  <th>Created</th>
                  <th style={{ width: 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id}>
                    <td style={{ fontWeight: 600 }}>{lot.lot_number}</td>
                    <td>{lot.challan_no}</td>
                    <td>{new Date(lot.createdAt).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openPhoto(lot)}
                        disabled={!lot.challan_photo_path}
                        title={lot.challan_photo_path ? undefined : "No challan photo"}
                      >
                        <ImageIcon size={14} /> Challan
                      </button>
                    </td>
                  </tr>
                ))}
                {lots.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      {search.trim() ? "No lots match this search." : "No lots yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Pager page={page} total={total} onChange={setPage} label="lots" />

      <Modal isOpen={creating} onClose={() => !saving && setCreating(false)} title="New lot" size="medium">
        <form onSubmit={submit} style={{ display: "grid", gap: 14, padding: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>
              Challan number <span style={{ color: "var(--rt-error)" }}>*</span>
            </span>
            <input
              className="input"
              value={challanNo}
              onChange={(e) => setChallanNo(e.target.value)}
              autoFocus
              maxLength={100}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>
              Challan photo <span style={{ color: "var(--rt-error)" }}>*</span>
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
          {preview && (
            <img
              src={preview}
              alt="Challan"
              style={{ maxHeight: 240, objectFit: "contain", borderRadius: 8, border: "1px solid var(--rt-card-border)" }}
            />
          )}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            The lot number is given automatically when you create it.
          </p>
          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !challanNo.trim() || !photo}>
              {saving ? "Creating…" : "Create lot"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.lot_number} · Challan ${viewing.challan_no}` : "Challan"}
        size="large"
      >
        {viewing?.challan_photo_url ? (
          <img
            src={viewing.challan_photo_url}
            alt={`Challan ${viewing.challan_no}`}
            style={{ width: "100%", maxHeight: "75vh", objectFit: "contain", display: "block" }}
          />
        ) : (
          <p className="muted" style={{ padding: 16 }}>The challan photo could not be loaded.</p>
        )}
      </Modal>
    </div>
  );
}
