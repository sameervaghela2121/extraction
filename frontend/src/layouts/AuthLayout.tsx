import type { ReactNode } from "react";

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 400, padding: 28 }}>
        <div className="row gap-8" style={{ marginBottom: 20 }}>
          {/* The Royale Touche shield — the same logo as the mobile app's top bar. */}
          <img
            src="/rt-logo-shield.png"
            alt=""
            style={{ height: 46, width: "auto", display: "block" }}
          />
          <strong style={{ fontSize: 18 }}>Royal Touche</strong>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h1>
        {subtitle && <p className="muted" style={{ marginTop: 6 }}>{subtitle}</p>}
        <div style={{ marginTop: 20 }}>{children}</div>
      </div>
    </div>
  );
}
