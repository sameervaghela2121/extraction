import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

/**
 * Click-to-sort table headers, shared by the spec-driven master tables (MasterSection) and
 * the hand-written Raw materials one, so the two behave and look identical.
 *
 * `null` only when a table declares nothing sortable. A table that has a sortable column
 * starts on it rather than in an "unsorted" state — see nextSort.
 */
export type Sort = { key: string; dir: "asc" | "desc" } | null;

/**
 * The state one click produces.
 *
 * Strictly asc ↔ desc, with no third "cleared" step. Cleared meant "whatever order the API
 * returned", which is only distinguishable from ascending if the two disagree — and on the
 * vendors table they don't (the API sorts by name, and a vendor_code is the slugified name
 * for 71 of 74 rows). Half the clicks then rendered an identical list and read as broken.
 */
export function nextSort(prev: Sort, key: string): Sort {
  if (prev?.key !== key) return { key, dir: "asc" };
  return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
}

/**
 * Compare two cells of one column.
 *
 * Blanks sort last in BOTH directions — a column of dashes at the top of a descending sort
 * is never what someone clicking a header wanted. Text uses `numeric: true` so "Bay 10"
 * lands after "Bay 9" rather than before it.
 */
export function compareCells(a: unknown, b: unknown, numeric = false): number {
  const aBlank = a === null || a === undefined || a === "";
  const bBlank = b === null || b === undefined || b === "";
  if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1;
  if (numeric) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** A `<th>` whose label is the sort control. Styling lives in global.css (.sort-header) so
 *  both tables pick up the same treatment. */
export function SortHeader({
  label,
  sortKey,
  sort,
  onToggle,
  style,
}: {
  label: string;
  sortKey: string;
  sort: Sort;
  onToggle: (key: string) => void;
  style?: React.CSSProperties;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    // aria-sort belongs on the header cell, not the button inside it — that is the element
    // a screen reader announces the column by.
    <th
      style={style}
      aria-sort={!active ? "none" : sort.dir === "asc" ? "ascending" : "descending"}
    >
      <button
        type="button"
        className={`sort-header${active ? " active" : ""}`}
        onClick={() => onToggle(sortKey)}
      >
        {label}
        <Icon size={13} />
      </button>
    </th>
  );
}
