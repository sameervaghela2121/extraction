import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { documentsApi } from "../../api/documents.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { StatusPill, Spinner } from "../../components/ui";
import { isMobileDevice } from "../../utils/device";
import type { DocumentDetail } from "../../types";

export default function DocumentDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Desktop Chrome renders a PDF inline for <iframe src="...">; mobile browsers
  // deliberately don't (they show a generic "tap to open" placeholder instead), so
  // mobile gets a real "open" action routed through the OS's own PDF handling instead.
  const [isMobile] = useState(isMobileDevice);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await documentsApi.detail(id);
      setDoc(d);
      setEdits({});
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [id, notify]);

  useEffect(() => {
    load();
  }, [load]);

  // The iframe can't carry the JWT header itself, so fetch the file as an authenticated
  // blob and point the iframe at the resulting local object URL instead. Keyed on id +
  // extractionStatus (not the whole `doc`) so saving a field doesn't re-fetch the PDF.
  useEffect(() => {
    if (!doc || doc.extractionStatus === "failed") return;
    let objectUrl: string | null = null;
    documentsApi
      .getFilePreviewUrl(doc.id)
      .then((url) => {
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch((err) => notify(apiErrorMessage(err), "error"));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc?.id, doc?.extractionStatus, notify]);

  const saveFields = async () => {
    if (Object.keys(edits).length === 0) return;
    setSaving(true);
    try {
      const updated = await documentsApi.updateFields(id, edits);
      setDoc(updated);
      setEdits({});
      notify("Fields saved");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const act = async (action: "verify" | "archive" | "restore") => {
    try {
      if (action === "verify") await documentsApi.verify(id);
      if (action === "archive") await documentsApi.archive(id);
      if (action === "restore") await documentsApi.restore(id);
      notify(
        action === "verify"
          ? "Document verified"
          : action === "archive"
            ? "Document deleted"
            : "Document restored",
      );
      if (action === "archive") {
        navigate("/documents");
        return;
      }
      load();
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  if (loading) return <Spinner label="Loading document…" />;
  if (!doc) return null;

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 14 }}>
        <ArrowLeft size={14} /> Back to documents
      </button>

      <div className="detail-grid">
        {/* Left column: PDF preview + action buttons */}
        <div className="stack" style={{ gap: 16 }}>
          <div className="card preview-card" style={{ padding: 12, overflow: "hidden" }}>
            {doc.extractionStatus === "failed" ? (
              <div className="stack" style={{ padding: 24, gap: 8 }}>
                <strong style={{ color: "var(--danger)" }}>Extraction failed</strong>
                <span className="muted" style={{ fontSize: 13 }}>{doc.extractionError}</span>
              </div>
            ) : !previewUrl ? (
              <Spinner label="Loading preview…" />
            ) : isMobile ? (
              <div className="stack" style={{ alignItems: "center", textAlign: "center", padding: "40px 20px", gap: 10 }}>
                <FileText size={40} style={{ color: "var(--text-muted)" }} />
                <div style={{ fontWeight: 600 }}>{doc.title}</div>
                <button className="btn btn-primary" onClick={() => window.open(previewUrl, "_blank")}>
                  Open document
                </button>
              </div>
            ) : (
              <iframe
                title="Document preview"
                src={previewUrl}
                className="preview-iframe"
                style={{ width: "100%", border: "none", borderRadius: 8 }}
              />
            )}
          </div>

          <div className="row gap-8" style={{ flexWrap: "wrap" }}>
            {doc.status === "archived" ? (
              <button className="btn btn-primary" onClick={() => act("restore")}>Restore document</button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => act("verify")}>Approve & verify</button>
                <button className="btn btn-danger" onClick={() => act("archive")}>Delete</button>
              </>
            )}
          </div>
        </div>

        {/* Middle column: fields */}
        <div className="card detail-fields-card" style={{ padding: 18 }}>
          <div className="row" style={{ marginBottom: 4, flexWrap: "wrap", rowGap: 4 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, minWidth: 0, overflowWrap: "break-word" }}>{doc.title}</h2>
            <div className="spacer" />
            <StatusPill status={doc.status} />
          </div>
          <div className="row gap-12" style={{ marginBottom: 16, flexWrap: "wrap" }}>
            <span className="faint" style={{ fontSize: 12 }}>
              Invoice · via {doc.source} · {new Date(doc.uploadedAt).toLocaleDateString()}
            </span>
          </div>
          {doc.validation && doc.confidence !== "high" && (
            <div
              style={{
                fontSize: 13,
                padding: "8px 12px",
                background: "var(--danger-soft)",
                color: "oklch(40% 0.16 25)",
                borderRadius: "var(--radius-sm)",
                marginBottom: 14,
              }}
            >
              {doc.validation}
            </div>
          )}

          <div className="stack" style={{ gap: 12 }}>
            {doc.fields.map((f) => (
              <div key={f.key}>
                <label className="field-label" style={{ textTransform: "capitalize" }}>
                  {f.key.replace(/_/g, " ")}
                </label>
                <input
                  className="input"
                  value={edits[f.key] ?? (f.value ?? "").toString()}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            {doc.fields.length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>
                {doc.extractionStatus === "processing"
                  ? "Extraction in progress — check back shortly."
                  : "No fields extracted."}
              </div>
            )}
          </div>

          {hasEdits && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveFields} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>

        {/* Right column: activity */}
        <div className="card detail-fields-card" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Activity</h3>
          <div className="stack" style={{ gap: 12 }}>
            {doc.activity.map((a, i) => (
              <div key={i} className="row gap-8" style={{ alignItems: "flex-start" }}>
                <span className="dot dot-high" style={{ marginTop: 6 }} />
                <div>
                  <div style={{ fontSize: 13 }}>
                    <strong>{a.action}</strong> · {a.actor}
                  </div>
                  <div className="faint" style={{ fontSize: 12 }}>{new Date(a.timestamp).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        /* This page needs more width than the app's default 1200px content cap (that cap is an
           inline style on .app-main, so overriding it from here needs !important — a plain class
           rule can't win against an inline style). Only applies while this page is mounted. */
        .app-main { max-width: 1600px !important; }
        .detail-grid { display: grid; grid-template-columns: 1.2fr 0.9fr 0.8fr; gap: 20px; align-items: start; }
        .preview-card, .detail-fields-card { height: min(824px, calc(75vh + 24px)); box-sizing: border-box; }
        .detail-fields-card { overflow-y: auto; }
        .preview-iframe { height: 100%; }
        @media (max-width: 900px) {
          .app-main { max-width: none !important; }
          .detail-grid { grid-template-columns: 1fr; }
          .preview-card, .detail-fields-card { height: auto; }
          .preview-iframe { height: 65vh; }
          .detail-fields-card { overflow-y: visible; }
        }
      `}</style>
    </div>
  );
}
