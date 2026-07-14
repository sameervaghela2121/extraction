import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadsApi } from "../../api/uploads.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";

interface QueuedFile {
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
}

export default function FileUploadTab() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setQueue(list.map((f) => ({ name: f.name, progress: 0, status: "uploading" as const })));
    try {
      await uploadsApi.upload(list, (pct) =>
        setQueue((q) => q.map((item) => ({ ...item, progress: pct }))),
      );
      setQueue((q) => q.map((item) => ({ ...item, progress: 100, status: "done" as const })));
      notify(`${list.length} document${list.length > 1 ? "s" : ""} queued for extraction`);
      setTimeout(() => navigate("/documents"), 900);
    } catch (err) {
      setQueue((q) => q.map((item) => ({ ...item, status: "error" as const })));
      notify(apiErrorMessage(err, "Upload failed"), "error");
    }
  };

  return (
    <div className="card" style={{ padding: 24, maxWidth: 640 }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        style={{
          border: `2px dashed ${dragging ? "var(--brand)" : "var(--border-strong)"}`,
          background: dragging ? "var(--brand-soft)" : "var(--surface-2)",
          borderRadius: "var(--radius)",
          padding: "42px 24px",
          textAlign: "center",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }}>⬆</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Drag & drop your invoices here</div>
        <div className="faint" style={{ fontSize: 13, marginBottom: 16 }}>PDF, JPG or PNG — up to 20MB</div>
        <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {queue.length > 0 && (
        <div className="stack" style={{ gap: 10, marginTop: 18 }}>
          {queue.map((f, i) => (
            <div key={i} className="stack" style={{ gap: 5 }}>
              <div className="row" style={{ fontSize: 13 }}>
                <span>{f.name}</span>
                <div className="spacer" />
                <span className="faint">
                  {f.status === "error" ? "Failed" : f.status === "done" ? "Queued" : `${f.progress}%`}
                </span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: "var(--surface-2)" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${f.progress}%`,
                    borderRadius: 999,
                    background: f.status === "error" ? "var(--danger)" : "var(--brand)",
                    transition: "width 0.2s",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
