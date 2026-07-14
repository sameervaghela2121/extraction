import { useEffect, useState } from "react";
import { uploadsApi } from "../../api/uploads.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";

export default function EmailInTab() {
  const { notify } = useToast();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    uploadsApi
      .inboundEmailAddress()
      .then((r) => setAddress(r.address))
      .catch((err) => notify(apiErrorMessage(err), "error"));
  }, [notify]);

  return (
    <div className="card" style={{ padding: 24, maxWidth: 640 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>Email-in</h3>
      <p className="muted" style={{ marginTop: 6 }}>
        Forward or send invoices as attachments to your personal inbox address. They'll appear in Documents within a minute.
      </p>

      <div
        className="row gap-8"
        style={{ marginTop: 16, padding: 16, background: "var(--surface-2)", borderRadius: "var(--radius)" }}
      >
        <code style={{ fontSize: 14, fontWeight: 600 }}>{address ?? "Loading…"}</code>
        <div className="spacer" />
        {address && (
          <button
            className="btn btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(address);
              notify("Address copied");
            }}
          >
            Copy
          </button>
        )}
      </div>

      <ul className="muted" style={{ fontSize: 13, marginTop: 16, paddingLeft: 18 }}>
        <li>One document per email works best</li>
        <li>PDF, JPG and PNG attachments are supported</li>
      </ul>
    </div>
  );
}
