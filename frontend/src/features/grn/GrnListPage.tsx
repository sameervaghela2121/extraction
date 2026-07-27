import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { grnApi } from "../../api/grn.api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader, GrnStatusPill, Spinner, EmptyState } from "../../components/ui";
import type { GrnListResponse } from "../../types";

export default function GrnListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notify } = useToast();

  const [data, setData] = useState<GrnListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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
                  <th>Invoice number</th>
                  <th>Invoice date</th>
                  <th>Items</th>
                  {user?.role === "admin" && <th className="hide-narrow">Created by</th>}
                  <th className="hide-narrow">Created</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((g) => (
                  <tr key={g.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/grn/${g.id}`)}>
                    <td style={{ fontWeight: 600 }}>{g.invoiceNo || "—"}</td>
                    <td className="muted">{g.invoiceDate || "—"}</td>
                    <td className="muted">{g.itemCount}</td>
                    {user?.role === "admin" && <td className="muted hide-narrow">{g.createdBy}</td>}
                    <td className="muted hide-narrow">{g.createdAt}</td>
                    <td><GrnStatusPill status={g.status} /></td>
                  </tr>
                ))}
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
    </div>
  );
}
