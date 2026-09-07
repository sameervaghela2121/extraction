import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 25;

/** Page a list that is already in memory. Every master endpoint returns its rows whole,
 *  so this is display paging — no fetch per page. */
export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE): T[] {
  return rows.slice((page - 1) * size, page * size);
}

export default function Pager({
  page,
  total,
  size = PAGE_SIZE,
  onChange,
  label,
}: {
  page: number;
  total: number;
  size?: number;
  onChange: (page: number) => void;
  /** Plural noun for the count line, e.g. "vendors". */
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  return (
    <div
      className="row gap-8"
      style={{ justifyContent: "space-between", padding: "10px 12px", flexWrap: "wrap" }}
    >
      <span className="faint" style={{ fontSize: 12 }}>
        {total === 0 ? `No ${label}` : `${from}–${to} of ${total} ${label}`}
      </span>
      <div className="row gap-8">
        <button
          className="btn btn-sm btn-ghost"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          Page {page} of {pages}
        </span>
        <button
          className="btn btn-sm btn-ghost"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
