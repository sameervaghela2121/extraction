import { useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { PageHeader } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { appApi } from "../../api/app.api";
import { apiErrorMessage } from "../../api/client";

export default function DownloadAppPage() {
  const { notify } = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const url = await appApi.apkDownloadUrl();
      // A signed GCS URL with Content-Disposition: attachment already set server-side —
      // this saves the file directly, no Drive-style confirmation page, no new tab. A
      // temporary link + click rather than window.location.href, so the current page
      // never flickers or looks like it's navigating away.
      const link = document.createElement("a");
      link.href = url;
      link.click();
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Download app"
        subtitle="Get the Royal Touche app for Android."
      />

      <div className="card" style={{ padding: 24, maxWidth: 480 }}>
        <div className="row gap-8" style={{ alignItems: "center", marginBottom: 14 }}>
          <Smartphone size={28} />
          <div>
            <strong style={{ fontSize: 15 }}>Royal Touche App</strong>
            <p className="faint" style={{ fontSize: 12, margin: "2px 0 0" }}>
              Android APK · scan and register rolls from the godown
            </p>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 13, margin: "0 0 16px" }}>
          Downloads the latest build straight to this device.
        </p>
        <button className="btn btn-primary" onClick={download} disabled={downloading}>
          <Download size={16} /> {downloading ? "Preparing…" : "Download APK"}
        </button>
      </div>
    </div>
  );
}
