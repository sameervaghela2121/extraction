import { useState } from "react";
import { PageHeader } from "../../components/ui";
import FileUploadTab from "./FileUploadTab";
import MobileScanTab from "./MobileScanTab";
import EmailInTab from "./EmailInTab";
import { isMobileDevice } from "../../utils/device";

type Tab = "file" | "scan" | "email";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "file", label: "Upload file" },
  { id: "scan", label: "Scan via mobile" },
  { id: "email", label: "Email-in" },
];

export default function UploadPage() {
  const [tab, setTab] = useState<Tab>("file");
  // Computed once per mount — the device a page is running on doesn't change mid-session.
  const [isMobile] = useState(isMobileDevice);

  return (
    <div>
      <PageHeader title="Upload & Scan" subtitle="Bring invoices into DocFlow for automatic extraction." />

      <div className="row gap-8" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const disabled = t.id === "scan" && !isMobile;
          return (
            <button
              key={t.id}
              className={`btn ${tab === t.id ? "btn-primary" : ""}`}
              disabled={disabled}
              title={disabled ? "Open this page on your phone to scan with its camera" : undefined}
              onClick={() => !disabled && setTab(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "file" && <FileUploadTab />}
      {tab === "scan" && isMobile && <MobileScanTab />}
      {tab === "email" && <EmailInTab />}
    </div>
  );
}
