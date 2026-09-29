import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { apiErrorMessage } from "../../api/client";
import type { SearchQuery } from "../../api/masters.api";
import { useToast } from "../../context/ToastContext";
import type { Paginated } from "../../types";
import { PAGE_SIZE } from "./Pager";
import type { Sort } from "./sorting";

/** How long typing has to pause before it becomes a search request. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * One server-paged, server-searched table: the current page's rows, the total they were cut
 * from, and the controls that drive them.
 *
 * - Typing is debounced, so a search is one request per pause rather than per keystroke.
 * - A new search or sort moves back to page 1 in the same render, so it costs one request —
 *   not one for the old page and a second for page 1.
 * - Only the newest request's answer is applied: a slow response for "ar" can't land after,
 *   and overwrite, the one for "arihant".
 */
export function useServerPage<T>(
  fetchPage: (query: SearchQuery) => Promise<Paginated<T>>,
  initialSort: Sort,
) {
  const { notify } = useToast();
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  /** What's in the search box. */
  const [search, setSearch] = useState("");
  /** What was last sent as `q` — the search box, once typing pauses. */
  const [query, setQuery] = useState("");
  const [sort, setSortState] = useState<Sort>(initialSort);
  /** True until the first page arrives — the table shows a spinner only then. */
  const [loading, setLoading] = useState(true);
  /** True while any request is in flight — later loads dim the table instead. */
  const [fetching, setFetching] = useState(false);

  // Refs, so a caller passing a fresh arrow function every render doesn't re-trigger loads.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === query) return;
    const timer = setTimeout(() => {
      setQuery(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, query]);

  const setSort = useCallback((next: SetStateAction<Sort>) => {
    setSortState(next);
    setPage(1);
  }, []);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setFetching(true);
    try {
      const res = await fetchRef.current({
        page,
        pageSize: PAGE_SIZE,
        q: query || undefined,
        sort: sort?.key,
        order: sort?.dir,
      });
      if (id !== latest.current) return;
      // The page emptied under us (its last row was removed, or went elsewhere in the sort):
      // step back to the last page that still has rows rather than show an empty table.
      if (res.items.length === 0 && page > 1 && res.total > 0) {
        setPage(res.totalPages);
        return;
      }
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      if (id === latest.current) notifyRef.current(apiErrorMessage(err), "error");
    } finally {
      if (id === latest.current) {
        setFetching(false);
        setLoading(false);
      }
    }
  }, [page, query, sort]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, setRows, total, page, setPage, search, setSearch, query, sort, setSort, loading, fetching, reload };
}
