import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { grnApi } from "../../api/grn.api";
import { documentsApi } from "../../api/documents.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { GrnStatusPill, Spinner } from "../../components/ui";
import { isMobileDevice } from "../../utils/device";
import type { GrnDetail, GrnStatus } from "../../types";
import { PurchaseInvoicePanel } from "./PurchaseInvoicePanel";

export default function GrnDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [grn, setGrn] = useState<GrnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Mobile browsers won't render a PDF in an iframe, so they get an "open" action instead.
  const [isMobile] = useState(isMobileDevice);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGrn(await grnApi.detail(id));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [id, notify]);

  useEffect(() => {
    load();
  }, [load]);

  // The iframe can't carry the JWT, so fetch the original invoice as an authenticated blob
  // and point at the resulting object URL. `cancelled` stops a late resolve from leaking it.
  useEffect(() => {
    const documentId = grn?.documentId;
    if (!documentId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    documentsApi
      .getFilePreviewUrl(documentId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch((err) => {
        if (!cancelled) notify(apiErrorMessage(err), "error");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [grn?.documentId, notify]);

  const decide = async (status: GrnStatus) => {
    setDeciding(true);
    try {
      await grnApi.setStatus(id, status);
      setGrn((prev) => (prev ? { ...prev, status } : prev));
      notify(status === "approved" ? "GRN approved" : "GRN rejected");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setDeciding(false);
    }
  };

  if (loading) return <Spinner label="Loading GRN…" />;
  if (!grn) return null;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 14 }}>
        <ArrowLeft size={14} /> Back to GRNs
      </button>

      <div className="grn-detail-grid">
        {/* Left: the original invoice */}
        <div className="card grn-preview-card" style={{ padding: 12, overflow: "hidden" }}>
          {!previewUrl ? (
            <Spinner label="Loading invoice…" />
          ) : isMobile ? (
            <div className="stack" style={{ alignItems: "center", textAlign: "center", padding: "40px 20px", gap: 10 }}>
              <FileText size={40} style={{ color: "var(--text-muted)" }} />
              <div style={{ fontWeight: 600 }}>{grn.title}</div>
              <button className="btn btn-primary" onClick={() => window.open(previewUrl, "_blank")}>
                Open invoice
              </button>
            </div>
          ) : (
            <iframe
              title="Invoice preview"
              // Chrome's thumbnail sidebar is a sticky per-profile preference, not something
              // this page can set — #pagemode=none / #navpanes=0 are not in Chrome's supported
              // fragment params and are ignored. Closing it once via the viewer's own toggle
              // makes it stay closed. Verified empirically; don't re-add a fragment here.
              src={previewUrl}
              className="grn-preview-iframe"
              style={{ width: "100%", border: "none", borderRadius: 8 }}
            />
          )}
        </div>

        <PurchaseInvoicePanel invoice={grn.invoice} grnItems={grn.items} />

        {/* Right: what was received */}
        <div className="card grn-detail-card" style={{ padding: 18 }}>
          <div className="row" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700 }}>Goods receipt</h2>
            <div className="spacer" />
            <GrnStatusPill status={grn.status} />
          </div>

          <div className="grn-meta">
            <div>
              <label className="field-label">Invoice number</label>
              <div style={{ fontWeight: 600 }}>{grn.invoiceNo || "—"}</div>
            </div>
            <div>
              <label className="field-label">Invoice date</label>
              <div style={{ fontWeight: 600 }}>{grn.invoiceDate || "—"}</div>
            </div>
          </div>

          <label className="field-label" style={{ marginTop: 18 }}>Items ({grn.items.length})</label>
          {grn.items.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No line items were captured.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Description</th>
                    <th style={{ width: 100 }}>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {grn.items.map((it, i) => (
                    <tr key={i}>
                      <td className="muted">{i + 1}</td>
                      <td>{it.description}</td>
                      {/* Blank stays blank — a null quantity means "not counted", not zero. */}
                      <td>{it.quantity == null ? "—" : it.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row gap-12 grn-decide" style={{ marginTop: 20 }}>
            <button
              className={`btn ${grn.status === "approved" ? "btn-primary" : ""}`}
              disabled={deciding}
              onClick={() => decide("approved")}
            >
              Approve
            </button>
            <button
              className={`btn ${grn.status === "rejected" ? "btn-danger" : ""}`}
              disabled={deciding}
              onClick={() => decide("rejected")}
            >
              Reject
            </button>
          </div>
        </div>
      </div>

      <style>{`
        /* Same widening trick as the document detail page — .app-main's 1200px cap is an
           inline style, so only !important can beat it. Scoped to this page's lifetime. */
        .app-main { max-width: 1800px !important; }
        .grn-detail-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; align-items: start; }
        .grn-preview-card, .grn-detail-card, .grn-invoice-card { height: min(824px, calc(75vh + 24px)); box-sizing: border-box; }
        .grn-detail-card, .grn-invoice-card { overflow-y: auto; }
        .grn-preview-iframe { height: 100%; }
        .grn-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 1300px) {
          .grn-detail-grid { grid-template-columns: 1fr 1fr; }
          .grn-invoice-card { grid-column: 1 / -1; height: auto; }
        }
        @media (max-width: 900px) {
          .app-main { max-width: none !important; }
          .grn-detail-grid { grid-template-columns: 1fr; }
          .grn-preview-card, .grn-detail-card, .grn-invoice-card { height: auto; }
          .grn-detail-card, .grn-invoice-card { overflow-y: visible; }
          .grn-decide .btn { flex: 1; min-height: 48px; justify-content: center; font-size: 15px; }
        }
      `}</style>
    </div>
  );
}
