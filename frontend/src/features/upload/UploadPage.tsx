import { useState } from "react";
import { PageHeader } from "../../components/ui";
import FileUploadTab from "./FileUploadTab";
import MobileScanTab from "./MobileScanTab";
import EmailInTab from "./EmailInTab";

type Tab = "file" | "scan" | "email";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "file", label: "Upload file" },
  { id: "scan", label: "Scan via mobile" },
  { id: "email", label: "Email-in" },
];

export default function UploadPage() {
  const [tab, setTab] = useState<Tab>("file");

  return (
    <div>
      <PageHeader title="Upload & Scan" subtitle="Bring invoices into DocFlow for automatic extraction." />

      <div className="row gap-8" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`btn ${tab === t.id ? "btn-primary" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "file" && <FileUploadTab />}
      {tab === "scan" && <MobileScanTab />}
      {tab === "email" && <EmailInTab />}
    </div>
  );
}
