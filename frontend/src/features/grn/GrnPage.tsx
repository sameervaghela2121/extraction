import { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import UploadTabs from "../upload/UploadTabs";
import { grnApi } from "../../api/grn.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { Spinner } from "../../components/ui";
import type { UploadResult } from "../../api/uploads.api";

type Phase = "upload" | "extracting" | "review" | "saved";

/** Quantity is held as a string while editing so partial input ("1.", "") stays typable;
 *  it becomes a number (or null) only on save. */
interface EditableItem {
  description: string;
  quantity: string;
}

interface EditableInvoice {
  documentId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  items: EditableItem[];
  saved: boolean;
}

interface FailedFile {
  title: string;
  error?: string;
}

const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

/** "" -> null so a blank box records "not counted" rather than "zero received". */
function toQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function GrnPage() {
  const { notify } = useToast();
  const [phase, setPhase] = useState<Phase>("upload");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [invoices, setInvoices] = useState<EditableInvoice[]>([]);
  const [failures, setFailures] = useState<FailedFile[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const reset = () => {
    setPhase("upload");
    setDocumentIds([]);
    setInvoices([]);
    setFailures([]);
  };

  const handleUploaded = (result: UploadResult) => {
    setDocumentIds(result.documents.map((d) => d.id));
    setPhase("extracting");
  };

  // Poll until every uploaded file has finished extracting (or failed), then hand the
  // lean invoice data to the review step.
  useEffect(() => {
    if (phase !== "extracting" || documentIds.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const poll = async () => {
      try {
        const draft = await grnApi.draft(documentIds);
        if (cancelled) return;

        const settled = draft.documents.every(
          (d) => d.extractionStatus === "done" || d.extractionStatus === "failed",
        );
        if (settled) {
          setInvoices(
            draft.documents.flatMap((d) =>
              d.invoices.map((inv) => ({
                documentId: d.documentId,
                invoiceId: inv.invoiceId,
                invoiceNo: inv.invoiceNo,
                invoiceDate: inv.invoiceDate,
                items: inv.items.map((it) => ({
                  description: it.description,
                  quantity: it.quantity == null ? "" : String(it.quantity),
                })),
                saved: inv.saved,
              })),
            ),
          );
          setFailures(
            draft.documents
              .filter((d) => d.extractionStatus === "failed")
              .map((d) => ({ title: d.title, error: d.extractionError })),
          );
          setPhase("review");
          return;
        }

        if (Date.now() > deadline) {
          notify("This is taking longer than expected — please try again.", "error");
          reset();
          return;
        }
        timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        notify(apiErrorMessage(err), "error");
        reset();
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, documentIds, notify]);

  // Every invoice saved -> done with this batch.
  useEffect(() => {
    if (phase === "review" && invoices.length > 0 && invoices.every((i) => i.saved)) {
      setPhase("saved");
    }
  }, [phase, invoices]);

  const patchInvoice = (invoiceId: string, patch: Partial<EditableInvoice>) =>
    setInvoices((prev) => prev.map((x) => (x.invoiceId === invoiceId ? { ...x, ...patch } : x)));

  const patchItem = (invoiceId: string, index: number, patch: Partial<EditableItem>) =>
    setInvoices((prev) =>
      prev.map((x) =>
        x.invoiceId === invoiceId
          ? { ...x, items: x.items.map((it, i) => (i === index ? { ...it, ...patch } : it)), saved: false }
          : x,
      ),
    );

  const save = async (inv: EditableInvoice) => {
    setSavingId(inv.invoiceId);
    try {
      await grnApi.save({
        documentId: inv.documentId,
        invoiceId: inv.invoiceId,
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate,
        items: inv.items.map((it) => ({
          description: it.description,
          quantity: toQuantity(it.quantity),
        })),
      });
      patchInvoice(inv.invoiceId, { saved: true });
      notify("GRN saved");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div>
      {/* No page heading — the nav already marks GRN as the active section. */}
      {phase === "upload" && <UploadTabs purpose="grn" onUploaded={handleUploaded} />}

      {phase === "extracting" && (
        <div className="card" style={{ padding: 28 }}>
          <Spinner label="Reading the invoice…" />
          <p className="muted" style={{ textAlign: "center", marginTop: 4, fontSize: 13 }}>
            This usually takes under a minute.
          </p>
        </div>
      )}

      {phase === "review" && (
        <div className="stack" style={{ gap: 16 }}>
          {failures.map((f, i) => (
            <div key={i} className="card" style={{ padding: 16, borderColor: "var(--danger)" }}>
              <strong style={{ color: "var(--danger)" }}>Couldn't read {f.title}</strong>
              {f.error && (
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{f.error}</div>
              )}
            </div>
          ))}

          {invoices.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: "center" }}>
              <p className="muted">No invoice data could be read from this upload.</p>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={reset}>
                Try another
              </button>
            </div>
          ) : (
            <>
              {invoices.map((inv) => (
                <div key={inv.invoiceId} className="card grn-card">
                  <div className="grn-meta">
                    <div>
                      <label className="field-label">Invoice number</label>
                      <input
                        className="input"
                        value={inv.invoiceNo}
                        onChange={(e) =>
                          patchInvoice(inv.invoiceId, { invoiceNo: e.target.value, saved: false })
                        }
                      />
                    </div>
                    <div>
                      <label className="field-label">Invoice date</label>
                      <input
                        className="input"
                        value={inv.invoiceDate}
                        onChange={(e) =>
                          patchInvoice(inv.invoiceId, { invoiceDate: e.target.value, saved: false })
                        }
                      />
                    </div>
                  </div>

                  <label className="field-label" style={{ marginTop: 18 }}>
                    Items ({inv.items.length})
                  </label>

                  {inv.items.length === 0 ? (
                    <p className="muted" style={{ fontSize: 13 }}>No line items were found on this invoice.</p>
                  ) : (
                    <div className="grn-items">
                      <div className="grn-row grn-head">
                        <span />
                        <span>Description</span>
                        <span>Quantity</span>
                      </div>
                      {inv.items.map((it, i) => (
                        <div className="grn-row" key={i}>
                          <span className="grn-idx">{i + 1}</span>
                          <input
                            className="input"
                            value={it.description}
                            onChange={(e) => patchItem(inv.invoiceId, i, { description: e.target.value })}
                          />
                          <div className="grn-qty">
                            <label className="field-label grn-qty-label">Quantity</label>
                            <input
                              className="input"
                              // decimal keypad on phones — this screen is used one-handed
                              inputMode="decimal"
                              value={it.quantity}
                              onChange={(e) => patchItem(inv.invoiceId, i, { quantity: e.target.value })}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grn-actions row gap-12">
                    <button
                      className="btn btn-primary"
                      disabled={savingId === inv.invoiceId}
                      onClick={() => save(inv)}
                    >
                      {savingId === inv.invoiceId ? "Saving…" : "Save GRN"}
                    </button>
                    {inv.saved && <span className="pill pill-verified">Saved</span>}
                  </div>
                </div>
              ))}

              <button className="btn btn-ghost btn-sm" onClick={reset} style={{ alignSelf: "flex-start" }}>
                <RotateCcw size={14} /> Start over
              </button>
            </>
          )}
        </div>
      )}

      {phase === "saved" && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <CheckCircle2 size={40} style={{ color: "var(--success)" }} />
          <h2 style={{ fontSize: 17, fontWeight: 700, marginTop: 10 }}>
            {invoices.length > 1 ? `${invoices.length} GRNs saved` : "GRN saved"}
          </h2>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            The goods receipt has been recorded.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={reset}>
            Scan another
          </button>
        </div>
      )}

      <style>{`
        .grn-card { padding: 18px; }
        .grn-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .grn-items { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
        /* 3 columns on a real screen; the whole thing restacks below 600px so a
           two-field table never needs a horizontal-scroll gesture on a phone. */
        .grn-row { display: grid; grid-template-columns: 30px 1fr 120px; gap: 10px; align-items: center; }
        .grn-head {
          font-size: 12px; font-weight: 600; color: var(--text-muted);
          padding-bottom: 6px; border-bottom: 1px solid var(--border);
        }
        .grn-idx { color: var(--text-faint); font-size: 12px; text-align: right; }
        .grn-qty-label { display: none; }
        .grn-actions { margin-top: 18px; }

        @media (max-width: 600px) {
          .grn-card { padding: 14px; }
          /* .grn-meta stays two columns at every width — invoice number and date sit
             side by side above the table, which is what the screen leads with. */
          .grn-head { display: none; }
          .grn-row {
            grid-template-columns: 1fr;
            gap: 8px;
            padding: 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--surface-2);
          }
          .grn-idx { text-align: left; font-weight: 600; color: var(--text-muted); }
          .grn-idx::before { content: "Item "; }
          .grn-qty-label { display: block; margin-bottom: 4px; }
          .grn-qty { max-width: 180px; }
          /* comfortable one-handed tap targets */
          .grn-row .input { min-height: 46px; font-size: 15px; }
          .grn-meta .input { min-height: 46px; font-size: 15px; }
          /* flex:1 rather than width:100% — the button fills the row but still leaves
             room for the "Saved" pill sitting beside it. */
          .grn-actions .btn { flex: 1; min-height: 48px; justify-content: center; font-size: 15px; }
        }
      `}</style>
    </div>
  );
}
