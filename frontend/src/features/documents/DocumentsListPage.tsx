import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUp, ArrowDown } from "lucide-react";
import { documentsApi, type DocumentQuery } from "../../api/documents.api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader, StatusPill, ExtractionStatusPill, Spinner, EmptyState } from "../../components/ui";
import type { DocumentListItem, DocumentListResponse } from "../../types";

export default function DocumentsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notify } = useToast();

  const [data, setData] = useState<DocumentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"date" | "title">("date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Page lives in the URL (not just component state) so that navigating into a document
  // and back restores the exact page you were on, instead of resetting to page 1.
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page")) || 1;
  const setPage = useCallback(
    (next: number | ((prev: number) => number)) => {
      setSearchParams(
        (prev) => {
          const nextPage = typeof next === "function" ? next(Number(prev.get("page")) || 1) : next;
          const params = new URLSearchParams(prev);
          if (nextPage <= 1) params.delete("page");
          else params.set("page", String(nextPage));
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: DocumentQuery = { search, sort, order, page, pageSize: 10 };
      setData(await documentsApi.list(query));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [search, sort, order, page, notify]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // While any row is still extracting, poll for updates every 10s; once every row has
  // reached a terminal extraction status ("done"/"failed"), this stops scheduling itself.
  useEffect(() => {
    if (!data) return;
    const stillExtracting = data.items.some(
      (d) => d.extractionStatus !== "done" && d.extractionStatus !== "failed",
    );
    if (!stillExtracting) return;
    const t = setTimeout(load, 10_000);
    return () => clearTimeout(t);
  }, [data, load]);

  const toggleSort = (field: "date" | "title") => {
    if (sort === field) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setOrder("desc");
    }
  };

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((d) => selected.has(d.id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((d) => d.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const bulk = async (action: "verify" | "archive") => {
    const ids = [...selected];
    try {
      if (action === "verify") await documentsApi.bulkVerify(ids);
      if (action === "archive") await documentsApi.bulkArchive(ids);
      const verb = action === "archive" ? "deleted" : "verified";
      notify(`${ids.length} document${ids.length > 1 ? "s" : ""} ${verb}`);
      setSelected(new Set());
      load();
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  return (
    <div>
      <PageHeader title="Documents" subtitle="Review and verify extracted invoices." />

      <div className="row gap-12" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search by title or uploader"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {selected.size > 0 && (
        <div
          className="card row gap-8"
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            background: "var(--brand-soft)",
            borderColor: "transparent",
            flexWrap: "wrap",
          }}
        >
          <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
          <div className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={() => bulk("verify")}>Approve & verify</button>
          <button className="btn btn-sm" onClick={() => bulk("archive")}>Delete</button>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {loading && !data ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState>Nothing here yet.</EmptyState>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("title")}>
                  <span className="row gap-8" style={{ display: "inline-flex" }}>
                    Document {sort === "title" && (order === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
                {user?.role === "admin" && <th className="hide-narrow">Uploaded by</th>}
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("date")}>
                  <span className="row gap-8" style={{ display: "inline-flex" }}>
                    Date {sort === "date" && (order === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
                <th>Amount</th>
                <th>Verification</th>
                <th className="hide-narrow">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d: DocumentListItem) => (
                <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/documents/${d.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.title}</div>
                    <div className="faint" style={{ fontSize: 12 }}>Invoice · via {d.source}</div>
                  </td>
                  {user?.role === "admin" && <td className="muted hide-narrow">{d.owner}</td>}
                  <td className="muted">{new Date(d.uploadedAt).toLocaleDateString()}</td>
                  <td>{d.amount != null ? `₹${d.amount.toLocaleString()}` : "—"}</td>
                  <td><StatusPill status={d.status} /></td>
                  <td className="hide-narrow"><ExtractionStatusPill status={d.extractionStatus} /></td>
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
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <button className="btn btn-sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
