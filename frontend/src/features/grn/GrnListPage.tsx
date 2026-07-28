import { Fragment, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronRight, X } from "lucide-react";
import { grnApi } from "../../api/grn.api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader, GrnStatusPill, Spinner, EmptyState, Modal } from "../../components/ui";
import { GrnDetailContent } from "./GrnDetailContent";
import type { GrnDetail, GrnItem, GrnListResponse, GrnMatchStatus, GrnStatus } from "../../types";

const MATCH_DOT_CLASS: Record<GrnMatchStatus, string> = {
  match: "dot-high",
  mismatch: "dot-attention",
  unknown: "dot-neutral",
};

const MATCH_TITLE: Record<GrnMatchStatus, string> = {
  match: "Received quantities match the invoice",
  mismatch: "Received quantities differ from the invoice",
  unknown: "No invoice quantity to compare against",
};

/** Unlike the initial-capture screen (blank = "not yet counted"), clearing the box here
 *  is a staffer actively correcting a saved GRN — blank means "confirmed zero arrived". */
function toQuantityOrZero(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function GrnListPage() {
  const { user } = useAuth();
  const { notify } = useToast();

  const [data, setData] = useState<GrnListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);

  // Modal state: which GRN is open, and its full detail (fetched on open).
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GrnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Inline row expansion: a quick items-only preview, separate from the modal.
  // Items are fetched once per row and cached — collapsing/re-expanding doesn't refetch.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [itemsById, setItemsById] = useState<Record<string, GrnItem[]>>({});
  const [loadingItemIds, setLoadingItemIds] = useState<Set<string>>(new Set());

  // Staff-only: quantities being edited in the dropdown, kept as strings per row so a
  // half-typed value doesn't get coerced mid-keystroke. Seeded from itemsById on expand.
  const [editQty, setEditQty] = useState<Record<string, string[]>>({});
  const [savingQtyId, setSavingQtyId] = useState<string | null>(null);

  // Page lives in the URL so opening a GRN and coming back lands on the same page.
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page")) || 1;
  const setPage = (next: number) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next <= 1) params.delete("page");
        else params.set("page", String(next));
        return params;
      },
      { replace: true },
    );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await grnApi.list(page, 10, search));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [page, search, notify]);

  // Debounced so typing fires one request after the pause, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const items = data?.items ?? [];

  const openModal = async (id: string) => {
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await grnApi.detail(id));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setOpenId(null);
    setDetail(null);
  };

  const toggleExpand = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (itemsById[id]) return;
    setLoadingItemIds((prev) => new Set(prev).add(id));
    try {
      const d = await grnApi.detail(id);
      setItemsById((prev) => ({ ...prev, [id]: d.items }));
      if (user?.role === "staff") {
        setEditQty((prev) => ({
          ...prev,
          [id]: d.items.map((it) => (it.quantity == null ? "" : String(it.quantity))),
        }));
      }
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoadingItemIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const updateQtyField = (id: string, index: number, value: string) =>
    setEditQty((prev) => ({
      ...prev,
      [id]: (prev[id] ?? []).map((v, i) => (i === index ? value : v)),
    }));

  const isQtyDirty = (id: string) => {
    const edited = editQty[id];
    const original = itemsById[id];
    if (!edited || !original) return false;
    return edited.some((v, i) => v !== (original[i].quantity == null ? "" : String(original[i].quantity)));
  };

  const saveQuantities = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const edited = editQty[id];
    if (!edited) return;
    setSavingQtyId(id);
    try {
      const quantities = edited.map(toQuantityOrZero);
      await grnApi.updateQuantities(id, quantities);
      setItemsById((prev) => ({
        ...prev,
        [id]: prev[id].map((it, i) => ({ ...it, quantity: quantities[i] })),
      }));
      setEditQty((prev) => ({ ...prev, [id]: quantities.map(String) }));
      notify("Quantities updated");
      load(); // refreshes the row's Match dot, computed server-side from the new quantities
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSavingQtyId(null);
    }
  };

  const decide = async (id: string, status: GrnStatus, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDecidingId(id);
    try {
      await grnApi.setStatus(id, status);
      setData((prev) =>
        prev ? { ...prev, items: prev.items.map((g) => (g.id === id ? { ...g, status } : g)) } : prev,
      );
      notify(status === "approved" ? "GRN approved" : "GRN rejected");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <div>
      <PageHeader title="GRN" subtitle="Goods receipt notes captured from invoices." />

      <div className="row gap-12" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search by invoice number"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading && !data ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState>
            {search ? "No GRNs match that search." : "No GRNs yet — capture one from Create GRN."}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Invoice number</th>
                  <th>Invoice date</th>
                  <th>Items</th>
                  {user?.role === "admin" && <th className="hide-narrow">Created by</th>}
                  <th className="hide-narrow">Created</th>
                  <th>Status</th>
                  <th style={{ width: 50 }}>Match</th>
                  {user?.role === "admin" && <th style={{ width: 90 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((g) => {
                  const isExpanded = expandedIds.has(g.id);
                  const rowItems = itemsById[g.id];
                  const isLoadingItems = loadingItemIds.has(g.id);
                  // Base columns everyone sees, plus "Created by" and "Actions" — both admin-only.
                  const colCount = 7 + (user?.role === "admin" ? 2 : 0);

                  return (
                    <Fragment key={g.id}>
                      <tr style={{ cursor: "pointer" }} onClick={() => openModal(g.id)}>
                        <td>
                          <button
                            className="btn-icon btn-icon-plain"
                            onClick={(e) => toggleExpand(g.id, e)}
                            aria-label={isExpanded ? "Collapse items" : "Expand items"}
                            title={isExpanded ? "Collapse items" : "Expand items"}
                          >
                            <ChevronRight size={16} className={`grn-chevron${isExpanded ? " open" : ""}`} />
                          </button>
                        </td>
                        <td style={{ fontWeight: 600 }}>{g.invoiceNo || "—"}</td>
                        <td className="muted">{g.invoiceDate || "—"}</td>
                        <td className="muted">{g.itemCount}</td>
                        {user?.role === "admin" && <td className="muted hide-narrow">{g.createdBy}</td>}
                        <td className="muted hide-narrow">{g.createdAt}</td>
                        <td><GrnStatusPill status={g.status} /></td>
                        <td>
                          <span className={`dot ${MATCH_DOT_CLASS[g.match]}`} title={MATCH_TITLE[g.match]} />
                        </td>
                        {user?.role === "admin" && (
                          <td>
                            <div className="row gap-8 grn-actions-cell" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="btn-icon btn-icon-accept"
                                disabled={decidingId === g.id || g.status === "approved"}
                                onClick={(e) => decide(g.id, "approved", e)}
                                aria-label="Approve"
                                title="Approve"
                              >
                                <Check size={16} />
                              </button>
                              <button
                                className="btn-icon btn-icon-reject"
                                disabled={decidingId === g.id || g.status === "rejected"}
                                onClick={(e) => decide(g.id, "rejected", e)}
                                aria-label="Reject"
                                title="Reject"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>

                      {/* Always mounted (not just when expanded) so the accordion animates both
                          ways — a conditionally-rendered row can only ever pop in, never close
                          smoothly. Height is driven by the grid-template-rows 0fr/1fr trick. */}
                      <tr className="grn-expand-row">
                        <td colSpan={colCount} style={{ padding: 0 }}>
                          <div className={`grn-expand-wrap${isExpanded ? " open" : ""}`}>
                            <div className="grn-expand-inner">
                              {isLoadingItems || !rowItems ? (
                                isExpanded && <Spinner label="Loading items…" />
                              ) : rowItems.length === 0 ? (
                                <p className="muted" style={{ padding: 16, fontSize: 13 }}>
                                  No line items were captured.
                                </p>
                              ) : (
                                <div className="table-scroll grn-expand-table-wrap">
                                  <table className="table grn-expand-table">
                                    <thead>
                                      <tr>
                                        <th style={{ width: 40 }}>#</th>
                                        <th>Description</th>
                                        <th style={{ width: 80 }}>Unit</th>
                                        <th style={{ width: 110 }}>Quantity</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rowItems.map((it, i) => (
                                        <tr key={i}>
                                          <td className="muted">{i + 1}</td>
                                          <td>{it.description}</td>
                                          <td className="muted">{it.unit || "—"}</td>
                                          <td>
                                            {user?.role === "staff" ? (
                                              <input
                                                className="input grn-qty-input"
                                                inputMode="decimal"
                                                placeholder="0"
                                                value={editQty[g.id]?.[i] ?? ""}
                                                onChange={(e) => updateQtyField(g.id, i, e.target.value)}
                                              />
                                            ) : it.quantity == null ? (
                                              "—"
                                            ) : (
                                              it.quantity
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {user?.role === "staff" && (
                                    <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                                      <button
                                        className="btn btn-primary btn-sm"
                                        disabled={!isQtyDirty(g.id) || savingQtyId === g.id}
                                        onClick={(e) => saveQuantities(g.id, e)}
                                      >
                                        {savingQtyId === g.id ? "Saving…" : "Save quantities"}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="row gap-8" style={{ marginTop: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Page {data.page} of {data.totalPages}
          </span>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn btn-sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      <Modal isOpen={openId !== null} onClose={closeModal} title="Goods receipt" size="xlarge">
        <GrnDetailContent grn={detail} loading={detailLoading} />
      </Modal>

      <style>{`
        .btn-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-strong);
          background: var(--surface);
          transition: background 0.12s, border-color 0.12s, opacity 0.12s, transform 0.12s;
        }
        .btn-icon:active:not(:disabled) {
          transform: scale(0.92);
        }
        .btn-icon:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btn-icon-plain {
          border-color: transparent;
          background: transparent;
          color: var(--text-muted);
        }
        .btn-icon-plain:hover:not(:disabled) {
          background: var(--surface-2);
          border-color: var(--border-strong);
        }
        .grn-chevron {
          transition: transform 0.2s ease;
        }
        .grn-chevron.open {
          transform: rotate(90deg);
        }
        .btn-icon-accept {
          color: var(--success);
        }
        .btn-icon-accept:hover:not(:disabled) {
          background: var(--success-soft);
          border-color: var(--success);
        }
        .btn-icon-reject {
          color: var(--danger);
        }
        .btn-icon-reject:hover:not(:disabled) {
          background: var(--danger-soft);
          border-color: var(--danger);
        }

        /* ---- Accordion (expand/collapse) ----
           grid-template-rows 0fr -> 1fr is the standard trick for animating to/from
           "auto" height, which a plain max-height or height transition can't do. */
        /* Direct-child combinator (>) is required here — a plain descendant selector
           also matches the <td> cells of the nested items table below, stripping their
           padding/borders and making that table look like unstyled text with no lines. */
        .grn-expand-row > td {
          padding: 0;
          border-bottom: none;
        }
        /* Must out-specificity global.css's ".table tbody tr:hover" (0,2,2) or the
           whole-width expand row picks up its gray hover tint whenever the cursor
           passes over it — hence the extra ".table tbody" prefix here, not just the class. */
        .table tbody tr.grn-expand-row:hover {
          background: none;
        }
        .grn-expand-wrap {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.22s ease;
        }
        .grn-expand-wrap.open {
          grid-template-rows: 1fr;
        }
        .grn-expand-inner {
          overflow: hidden;
          min-height: 0;
        }
        .grn-expand-wrap.open .grn-expand-inner {
          border-top: 1px solid var(--border);
        }
        .grn-expand-table tbody tr:last-child td {
          border-bottom: none;
        }
        /* Breathing room so the nested table reads like the spacious detail-page/modal
           table instead of sitting flush against the row's edges. */
        .grn-expand-table-wrap {
          padding: 16px 18px;
        }
        .grn-qty-input {
          width: 100%;
          min-width: 0;
          padding: 4px 8px;
          height: 30px;
          font-size: 13px;
        }
        /* The outer .table-scroll rule forces a 640px min-width on any nested .table
           so it can scroll independently on narrow screens — undo that here since this
           inner table should just wrap within its cell, not force its own scrollbar. */
        .grn-expand-row .table-scroll .table {
          min-width: 0;
        }

        @media (max-width: 600px) {
          .btn-icon {
            width: 38px;
            height: 38px;
          }
          .grn-actions-cell {
            gap: 6px;
          }
        }
      `}</style>
    </div>
  );
}
