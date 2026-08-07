import { useState } from "react";
import FileUploadTab from "./FileUploadTab";
import MobileScanTab from "./MobileScanTab";
import { isMobileDevice } from "../../utils/device";
import type { UploadResult } from "../../api/uploads.api";

type Tab = "file" | "scan";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "file", label: "Upload file" },
  { id: "scan", label: "Scan via mobile" },
];

interface Props {
  /** Passed through to the tabs: when set, the caller decides what happens after upload. */
  onUploaded?: (result: UploadResult) => void;
  purpose?: "invoice" | "grn" | "voucher";
  /** Where the default (no `onUploaded`) flow navigates after a successful upload. */
  redirectTo?: string;
}

/** The file-vs-camera intake used by Upload & Scan, GRN, and General Vouchers. */
export default function UploadTabs({ onUploaded, purpose, redirectTo }: Props) {
  const [tab, setTab] = useState<Tab>("file");
  // Computed once per mount — the device a page is running on doesn't change mid-session.
  const [isMobile] = useState(isMobileDevice);

  return (
    <>
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

      {tab === "file" && <FileUploadTab onUploaded={onUploaded} purpose={purpose} redirectTo={redirectTo} />}
      {tab === "scan" && isMobile && (
        <MobileScanTab onUploaded={onUploaded} purpose={purpose} redirectTo={redirectTo} />
      )}
    </>
  );
}
