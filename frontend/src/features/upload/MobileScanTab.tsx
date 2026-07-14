import { useState } from "react";
import { uploadsApi } from "../../api/uploads.api";
import { apiErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";

export default function MobileScanTab() {
  const { notify } = useToast();
  const [session, setSession] = useState<{ scanUrl: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const s = await uploadsApi.createScanSession();
      setSession(s);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 24, maxWidth: 640 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>Scan via mobile</h3>
      <p className="muted" style={{ marginTop: 6 }}>
        Start a session, then open the link on your phone to capture invoice pages with your camera.
      </p>

      {!session ? (
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={start} disabled={busy}>
          {busy ? "Starting…" : "Start scan session"}
        </button>
      ) : (
        <div
          className="stack"
          style={{ gap: 10, marginTop: 16, padding: 16, background: "var(--surface-2)", borderRadius: "var(--radius)" }}
        >
          <div className="faint" style={{ fontSize: 13 }}>Open this link on your phone (expires in 10 minutes):</div>
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>{session.scanUrl}</code>
          <button
            className="btn btn-sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              navigator.clipboard.writeText(session.scanUrl);
              notify("Link copied");
            }}
          >
            Copy link
          </button>
        </div>
      )}
    </div>
  );
}
