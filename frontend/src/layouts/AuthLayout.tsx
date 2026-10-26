import type { ReactNode } from "react";

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 400, padding: 28 }}>
        {/* The client's own wordmark, as on royaletouche.com. */}
        <img
          src="/royale-touche-logo.png"
          alt="Royale Touche"
          style={{ display: "block", height: 26, width: "auto", maxWidth: "100%", marginBottom: 22 }}
        />
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h1>
        {subtitle && <p className="muted" style={{ marginTop: 6 }}>{subtitle}</p>}
        <div style={{ marginTop: 20 }}>{children}</div>
      </div>
    </div>
  );
}
