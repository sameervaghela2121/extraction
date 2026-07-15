import type { ReactNode } from "react";
import type { Confidence, DocumentStatus } from "../types";

export function StatusPill({ status }: { status: DocumentStatus }) {
  const label = status === "pending" ? "Pending" : status === "verified" ? "Verified" : "Archived";
  return <span className={`pill pill-${status}`}>{label}</span>;
}

/** Extraction progress, from the shared Files collection — distinct from the portal's
 * own review-workflow `status` (pending/verified/archived) shown by StatusPill. */
export function ExtractionStatusPill({ status }: { status: string }) {
  const cls =
    status === "done" ? "pill-done"
    : status === "failed" ? "pill-failed"
    : status === "processing" || status === "retrying" ? "pill-processing"
    : "pill-unknown";
  const label =
    status === "done" ? "Extracted"
    : status === "failed" ? "Failed"
    : status === "processing" || status === "retrying" ? "Processing"
    : "Unknown";
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const high = confidence === "high";
  return (
    <span className="row gap-8" style={{ fontSize: 13 }}>
      <span className={`dot ${high ? "dot-high" : "dot-attention"}`} />
      {high ? "High confidence" : "Needs attention"}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return <span className="avatar">{initials}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row gap-8 muted" style={{ padding: 24, justifyContent: "center" }}>
      <span
        style={{
          width: 16,
          height: 16,
          border: "2px solid var(--border-strong)",
          borderTopColor: "var(--brand)",
          borderRadius: "999px",
          display: "inline-block",
          animation: "spin 0.7s linear infinite",
        }}
      />
      {label ?? "Loading…"}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="faint" style={{ textAlign: "center", padding: "48px 16px" }}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="row" style={{ marginBottom: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{title}</h1>
        {subtitle && <p className="muted" style={{ margin: "4px 0 0" }}>{subtitle}</p>}
      </div>
      <div className="spacer" />
      {actions}
    </div>
  );
}
