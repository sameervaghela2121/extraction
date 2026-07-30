import type { GrnItem, GrnSourceInvoice } from "../../types";

interface PurchaseInvoicePanelProps {
  invoice: GrnSourceInvoice | undefined;
  /** The GRN's own items, position-matched 1:1 against `invoice.items` (GRN capture
   *  never adds/removes rows — same assumption the backend's match indicator relies on),
   *  so a mismatched cell here can be highlighted against its counterpart. */
  grnItems: GrnItem[];
}

/** Mirrors the backend's own qty parsing (grn.service.ts's `toQuantity`) so a "1,086"
 *  string on the invoice compares equal to the number 1086 captured on the GRN. */
function parseQty(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function textDiffers(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim().toLowerCase() !== String(b ?? "").trim().toLowerCase();
}

/** Middle column of the GRN detail views: just the invoice's items table, restricted to
 *  the same three columns the goods-receipt table shows (description/unit/quantity) so
 *  the two line up for a direct visual comparison — any cell that differs from what was
 *  actually received gets a grey highlight. */
export function PurchaseInvoicePanel({ invoice, grnItems }: PurchaseInvoicePanelProps) {
  if (!invoice) {
    return (
      <div className="card grn-invoice-card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Purchase invoice</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          No invoice data was captured with this GRN.
        </p>
      </div>
    );
  }

  return (
    <div className="card grn-invoice-card" style={{ padding: 18 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Purchase invoice</h2>

      <label className="field-label">Items ({invoice.items.length})</label>
      {invoice.items.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No line items were captured.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Description</th>
                <th style={{ width: 80 }}>Unit</th>
                <th style={{ width: 100 }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, i) => {
                const grnItem = grnItems[i] as GrnItem | undefined;
                const unit = (item.unit as string | undefined) ?? "";
                const qty = parseQty(item.qty);
                const descMismatch = Boolean(grnItem) && textDiffers(item.description, grnItem!.description);
                const unitMismatch = Boolean(grnItem) && textDiffers(unit, grnItem!.unit ?? "");
                const qtyMismatch = Boolean(grnItem) && qty !== grnItem!.quantity;
                const rowMismatch = descMismatch || unitMismatch || qtyMismatch;
                return (
                  <tr key={i} className={rowMismatch ? "grn-invoice-row-mismatch" : undefined}>
                    <td className="muted">{i + 1}</td>
                    <td>{(item.description as string) ?? ""}</td>
                    <td>{unit || "—"}</td>
                    <td>{qty == null ? "—" : qty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .grn-invoice-row-mismatch td { background: var(--border-strong); }
      `}</style>
    </div>
  );
}
