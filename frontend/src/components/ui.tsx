import { useEffect, useState, type ReactNode } from "react";
import type { DocumentStatus, GrnStatus } from "../types";

const MODAL_ANIM_MS = 180;

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

/** Goods-receipt sign-off state. Reuses the same pill classes as the other two. */
export function GrnStatusPill({ status }: { status: GrnStatus }) {
  const cls = status === "approved" ? "pill-done" : status === "rejected" ? "pill-failed" : "pill-pending";
  const label =
    status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Awaiting approval";
  return <span className={`pill ${cls}`}>{label}</span>;
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

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "large",
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "small" | "medium" | "large" | "xlarge";
}) {
  // Stay mounted for one extra tick after isOpen flips false so the closing
  // animation can play instead of the modal just vanishing.
  const [visible, setVisible] = useState(isOpen);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      setClosing(true);
      const t = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, MODAL_ANIM_MS);
      return () => clearTimeout(t);
    }
    // visible intentionally omitted — only isOpen transitions should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!visible) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const sizeClass = `modal-${size}`;

  return (
    <>
      <div className={`modal-backdrop${closing ? " closing" : ""}`} onClick={handleBackdropClick}>
        <div className={`modal-content ${sizeClass}${closing ? " closing" : ""}`}>
          {title && (
            <div className="modal-header">
              <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={onClose}
                style={{ marginLeft: "auto" }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          )}
          <div className="modal-body">{children}</div>
        </div>
      </div>
      <style>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
          overflow-y: auto;
          animation: modalFadeIn ${MODAL_ANIM_MS}ms ease-out;
        }
        .modal-backdrop.closing {
          animation: modalFadeOut ${MODAL_ANIM_MS}ms ease-in forwards;
        }
        .modal-content {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow-md);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: modalScaleIn ${MODAL_ANIM_MS}ms ease-out;
        }
        .modal-content.closing {
          animation: modalScaleOut ${MODAL_ANIM_MS}ms ease-in forwards;
        }
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes modalScaleIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes modalScaleOut {
          from { opacity: 1; transform: scale(1) translateY(0); }
          to { opacity: 0; transform: scale(0.97) translateY(6px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .modal-backdrop, .modal-content {
            animation: none !important;
          }
        }
        .modal-small {
          width: 100%;
          max-width: 400px;
        }
        .modal-medium {
          width: 100%;
          max-width: 600px;
        }
        .modal-large {
          width: 100%;
          max-width: 900px;
        }
        .modal-xlarge {
          width: 100%;
          max-width: 1500px;
        }
        .modal-header {
          display: flex;
          align-items: center;
          padding: 18px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 18px;
        }
        @media (max-width: 600px) {
          .modal-backdrop {
            padding: 0;
            align-items: flex-end;
          }
          .modal-content {
            max-height: 92vh;
            border-radius: var(--radius) var(--radius) 0 0;
          }
          .modal-header, .modal-body {
            padding: 14px;
          }
        }
      `}</style>
    </>
  );
}
