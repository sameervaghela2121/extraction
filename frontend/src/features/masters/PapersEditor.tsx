import { useMemo, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import Pager, { pageOf } from "./Pager";
import type { VendorPaper } from "../../types";

const PAPERS_PER_PAGE = 10;

function matches(paper: VendorPaper, q: string): boolean {
  return [paper.royal_touche_code, paper.delta_code, paper.supplier_code_number, paper.found_in]
    .some((v) => (v ?? "").toLowerCase().includes(q));
}

/** Editor for a vendor's embedded paper-codes rows. The array is replaced wholesale on
 *  save — the rows have no id to merge on, which is why the backend PATCH swaps the set.
 *  `readOnly` reuses the same search + paging for the view-only papers list. */
export default function PapersEditor({
  papers,
  onChange,
  readOnly = false,
}: {
  papers: VendorPaper[];
  onChange?: (next: VendorPaper[]) => void;
  readOnly?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const setField = (index: number, field: keyof VendorPaper, value: string | boolean) =>
    onChange?.(papers.map((p, i) => (i === index ? { ...p, [field]: value } : p)));

  // Carry each row's index through the filter so edits and removals still address the
  // right entry in the full array — a big supplier has hundreds of rows.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = papers.map((paper, index) => ({ paper, index }));
    return q ? all.filter((e) => matches(e.paper, q)) : all;
  }, [papers, search]);

  // Clamp rather than reset: removing the last row of the last page should step back a
  // page, not throw the user to the top of a 200-row sheet.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAPERS_PER_PAGE));
  const current = Math.min(page, pageCount);
  const visible = pageOf(filtered, current, PAPERS_PER_PAGE);

  const addPaper = () => {
    onChange?.([...papers, {}]);
    // Land on the page holding the new row instead of leaving it off-screen.
    setSearch("");
    setPage(Math.ceil((papers.length + 1) / PAPERS_PER_PAGE));
  };

  return (
    <div>
      <div className="row gap-8" style={{ alignItems: "baseline", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Papers</strong>
        <span className="faint" style={{ fontSize: 12 }}>
          {readOnly
            ? "Only papers with a Royal Touche code can be picked for a roll."
            : "Each row needs a Royal Touche code or a Delta code. Only rows with an RT code can be picked for a roll."}
        </span>
      </div>

      <input
        className="input"
        style={{ marginBottom: 8 }}
        placeholder="Search papers by code"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>RT code</th>
              <th>Delta code</th>
              <th>Supplier code / name</th>
              <th>Found in</th>
              <th style={{ width: 70 }}>Common</th>
              {!readOnly && <th style={{ width: 44 }}></th>}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ paper: p, index: i }) => (
              // Index key: rows are positional and only ever appended or removed as a set.
              <tr key={i}>
                <td>
                  {readOnly ? (
                    p.royal_touche_code || "—"
                  ) : (
                    <input
                      className="input"
                      value={p.royal_touche_code ?? ""}
                      onChange={(e) => setField(i, "royal_touche_code", e.target.value)}
                    />
                  )}
                </td>
                <td>
                  {readOnly ? (
                    p.delta_code || "—"
                  ) : (
                    <input
                      className="input"
                      value={p.delta_code ?? ""}
                      onChange={(e) => setField(i, "delta_code", e.target.value)}
                    />
                  )}
                </td>
                <td>
                  {readOnly ? (
                    p.supplier_code_number || "—"
                  ) : (
                    <input
                      className="input"
                      value={p.supplier_code_number ?? ""}
                      onChange={(e) => setField(i, "supplier_code_number", e.target.value)}
                    />
                  )}
                </td>
                <td>
                  {readOnly ? (
                    p.found_in || "—"
                  ) : (
                    <input
                      className="input"
                      value={p.found_in ?? ""}
                      onChange={(e) => setField(i, "found_in", e.target.value)}
                    />
                  )}
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(p.is_common)}
                    disabled={readOnly}
                    onChange={(e) => setField(i, "is_common", e.target.checked)}
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Remove paper"
                      onClick={() => onChange?.(papers.filter((_, x) => x !== i))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 5 : 6} className="faint" style={{ textAlign: "center", padding: 14 }}>
                  {papers.length === 0 ? "No papers yet." : "No papers match that search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pager
          page={current}
          total={filtered.length}
          size={PAPERS_PER_PAGE}
          onChange={setPage}
          label="papers"
        />
      </div>

      {!readOnly && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={addPaper}>
          <Plus size={14} /> Add paper
        </button>
      )}
    </div>
  );
}
