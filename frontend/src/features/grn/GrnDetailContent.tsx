import { FileText } from "lucide-react";
import { documentsApi } from "../../api/documents.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { GrnStatusPill, Spinner } from "../../components/ui";
import { isMobileDevice } from "../../utils/device";
import { useEffect, useState } from "react";
import type { GrnDetail } from "../../types";
import { PurchaseInvoicePanel } from "./PurchaseInvoicePanel";

interface GrnDetailContentProps {
  grn: GrnDetail | null;
  loading: boolean;
}

/** The invoice preview + captured items, shared by the GRN detail page and the
 *  read-only quick-view dialog opened from the GRN list. Deciding (approve/reject)
 *  lives with the caller, not here. */
export function GrnDetailContent({ grn, loading }: GrnDetailContentProps) {
  const { notify } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isMobile] = useState(isMobileDevice);

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

  if (loading || !grn) return <Spinner label="Loading GRN…" />;

  return (
    <div className="grn-detail-grid">
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
            src={previewUrl}
            className="grn-preview-iframe"
            style={{ width: "100%", border: "none", borderRadius: 8 }}
          />
        )}
      </div>

      <PurchaseInvoicePanel invoice={grn.invoice} grnItems={grn.items} />

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
          <div className="table-scroll grn-compare-scroll">
            <table className="table grn-compare-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Description</th>
                  <th style={{ width: 70 }}>Quantity</th>
                  <th style={{ width: 60 }}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {grn.items.map((it, i) => (
                  <tr key={i}>
                    <td className="muted">{i + 1}</td>
                    <td>{it.description}</td>
                    <td>{it.quantity == null ? "—" : it.quantity}</td>
                    <td className="muted">{it.unit || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <style>{`
          .grn-compare-scroll .grn-compare-table { min-width: 0 !important; }
          .grn-compare-table th, .grn-compare-table td { padding: 8px 8px; }
          .grn-detail-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; align-items: start; }
          .grn-preview-card, .grn-detail-card, .grn-invoice-card { height: min(900px, calc(80vh + 24px)); box-sizing: border-box; }
          .grn-detail-card, .grn-invoice-card { overflow-y: auto; }
          .grn-preview-iframe { height: 100%; }
          .grn-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          @media (max-width: 1200px) {
            .grn-detail-grid { grid-template-columns: 1fr 1fr; }
            .grn-invoice-card { grid-column: 1 / -1; height: auto; }
          }
          @media (max-width: 900px) {
            .grn-detail-grid { grid-template-columns: 1fr; }
            .grn-preview-card, .grn-detail-card, .grn-invoice-card { height: auto; }
            .grn-detail-card, .grn-invoice-card { overflow-y: visible; }
          }
        `}</style>
      </div>
    </div>
  );
}
