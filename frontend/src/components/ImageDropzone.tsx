import { useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

/**
 * Picks one image for a form to send later: drag it in or browse, then see it with the choice
 * to replace or remove it. The same dashed box as the document upload, which sends files the
 * moment they are picked — this one only holds the file.
 */
export default function ImageDropzone({
  file,
  onChange,
  label,
  disabled,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  /** What the image is, for its alt text and the prompt: "Challan photo". */
  label: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    // A dropped file skips the input's accept filter, so it is checked here.
    const isImage = picked.type.startsWith("image/");
    setRejected(!isImage);
    if (isImage) onChange(picked);
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) pick(e.dataTransfer.files[0]);
        }}
        style={{
          border: `2px dashed ${dragging ? "var(--brand)" : "var(--border-strong)"}`,
          background: dragging ? "var(--brand-soft)" : "var(--surface-2)",
          borderRadius: "var(--radius)",
          padding: preview ? 12 : "28px 20px",
          textAlign: "center",
          transition: "all 0.15s",
        }}
      >
        {preview ? (
          <>
            <img
              src={preview}
              alt={label}
              style={{ display: "block", width: "100%", maxHeight: 240, objectFit: "contain", borderRadius: 8 }}
            />
            <div className="faint" style={{ fontSize: 13, margin: "8px 0", overflowWrap: "anywhere" }}>
              {file?.name}
            </div>
            <div className="row gap-8" style={{ justifyContent: "center" }}>
              <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
                Replace
              </button>
              <button type="button" className="btn btn-sm" onClick={() => onChange(null)} disabled={disabled}>
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>
              <UploadCloud size={30} />
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Drag & drop the {label.toLowerCase()} here</div>
            <div className="faint" style={{ fontSize: 13, marginBottom: 14 }}>JPG or PNG</div>
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={disabled}>
              Browse files
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            // So picking the same file again after Remove still fires a change.
            e.target.value = "";
          }}
        />
      </div>
      {rejected && (
        <div style={{ color: "var(--rt-error)", fontSize: 13 }}>That file is not an image. Choose a JPG or PNG.</div>
      )}
    </div>
  );
}
