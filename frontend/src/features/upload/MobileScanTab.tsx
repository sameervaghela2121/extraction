import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadsApi } from "../../api/uploads.api";
import { apiErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface CapturedPage {
  file: File;
  previewUrl: string;
}

export default function MobileScanTab() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const addPage = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setPages((prev) => [...prev, { file, previewUrl: URL.createObjectURL(file) }]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removePage = (index: number) => {
    setPages((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const upload = async () => {
    if (pages.length === 0) return;
    setUploading(true);
    setProgress(0);
    try {
      await uploadsApi.upload(
        pages.map((p) => p.file),
        setProgress,
        "scan",
      );
      notify("Sent to Documents as an invoice");
      pages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPages([]);
      setTimeout(() => navigate("/documents"), 900);
    } catch (err) {
      notify(apiErrorMessage(err, "Upload failed"), "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card scan-card" style={{ padding: 24, maxWidth: 640 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>Scan via mobile</h3>
      <p className="muted" style={{ marginTop: 6 }}>
        Capture each page with your camera, then upload them all together — they'll be treated as one
        document.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => addPage(e.target.files)}
      />

      {pages.length > 0 && (
        <div className="scan-thumbs" style={{ marginTop: 16, marginBottom: 16 }}>
          {pages.map((p, i) => (
            <div key={p.previewUrl} className="scan-thumb">
              <img
                src={p.previewUrl}
                alt={`Page ${i + 1}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-strong)",
                }}
              />
              <button
                className="scan-thumb-remove"
                onClick={() => removePage(i)}
                disabled={uploading}
                aria-label={`Remove page ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="scan-actions">
        <button className="btn" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {pages.length === 0 ? "Add page" : "Add another page"}
        </button>
        <button className="btn btn-primary" onClick={upload} disabled={pages.length === 0 || uploading}>
          {uploading ? `Uploading… ${progress}%` : `Upload ${pages.length || ""} page${pages.length === 1 ? "" : "s"}`}
        </button>
      </div>

      <style>{`
        .scan-thumbs { display: flex; flex-wrap: wrap; gap: 10px; }
        .scan-thumb { position: relative; width: 92px; height: 92px; }
        .scan-thumb-remove {
          position: absolute; top: -8px; right: -8px;
          width: 30px; height: 30px; padding: 0; line-height: 1;
          border-radius: 999px; border: 1px solid var(--border-strong);
          background: var(--surface); color: var(--text); font-size: 16px;
          display: flex; align-items: center; justify-content: center;
        }
        .scan-actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .scan-actions .btn { flex: 1; min-width: 160px; }
        @media (max-width: 480px) {
          .scan-card { padding: 18px !important; }
          .scan-thumb { width: 100px; height: 100px; }
          .scan-actions { flex-direction: column; }
          .scan-actions .btn { width: 100%; min-height: 46px; font-size: 15px; }
        }
      `}</style>
    </div>
  );
}
