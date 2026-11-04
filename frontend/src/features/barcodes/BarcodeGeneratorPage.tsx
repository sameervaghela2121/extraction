import { useEffect, useState } from "react";
import { Search, Send, X } from "lucide-react";
import { rollsApi } from "../../api/rolls.api";
import { deltaCodes, rtCodes } from "../masters/rollPapers";
import { apiErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Label, { type LabelItem } from "./Label";
import { buildSeries, seriesCode, MAX_SERIES } from "./series";
import { buildPrintHtml } from "./printHtml";
import { barcodeBatchesApi, type BarcodeSearchResult } from "../../api/barcodeBatches.api";
import type { BarcodeBatch, MaterialRollListItem } from "../../types";
import { BARCODE_SIZES, defaultSizeFor, findSize, type LabelKind } from "./labelSizes";

const PAGE_SIZE = 25;
// ponytail: the roll picker is built and working, just not wanted on screen yet. Flip to
// true to bring back the search, the "Select page" button and the roll table.
const ROLL_PICKER_ENABLED = false;
// ponytail: QR code generation (qr.ts, and the QR paths in Label.tsx/printHtml.ts) is built
// and working, just not wanted on screen yet — flip to true to bring back the "Code type"
// dropdown so an operator can choose QR for a new run. Everything that already prints an
// existing QR run keeps working regardless of this flag: a batch's own saved `kind` (see
// barcodeBatchesService) decides how it re-renders, never this setting.
const QR_CODE_ENABLED = false;

interface LabelSizeMm {
  widthMm: number;
  heightMm: number;
}

const LABEL_KIND_STORAGE_KEY = "barcode-label-kind";
const DEFAULT_LABEL_KIND: LabelKind = "barcode";

/** Remembered per browser, same reasoning as sticker size below — a computer is wired to
 *  one printer, so which kind of code it prints is a setting of this screen. Forced to
 *  "barcode" while QR_CODE_ENABLED is off, even if an earlier session left "qr" saved. */
function loadLabelKind(): LabelKind {
  if (!QR_CODE_ENABLED) return "barcode";
  const raw = localStorage.getItem(LABEL_KIND_STORAGE_KEY);
  return raw === "qr" ? "qr" : DEFAULT_LABEL_KIND;
}

/** One size remembered per code type, so switching from barcode to QR and back doesn't lose
 *  either one's last pick — a 100x50mm barcode roll and a 40x40mm QR roll are both real
 *  setups an operator might alternate between. */
const LABEL_SIZE_STORAGE_KEY = "barcode-label-size-by-kind";

function loadLabelSize(kind: LabelKind): LabelSizeMm {
  // Barcode has one sticker size, fixed — no picker, nothing to remember. QR keeps its own
  // remembered-per-browser size below, for whenever QR_CODE_ENABLED comes back on.
  if (kind === "barcode") return BARCODE_SIZES[0];
  try {
    const raw = localStorage.getItem(LABEL_SIZE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const saved = parsed?.[kind];
      // Only trust it if it's still one of this kind's standard sizes — the list of
      // choices, not the stored value, is the source of truth for what's selectable.
      if (saved && findSize(kind, saved.widthMm, saved.heightMm)) return saved;
    }
  } catch {
    // Corrupt or blocked storage — fall back to the default rather than fail the page.
  }
  return defaultSizeFor(kind);
}

/** RT code when the paper has one, else its Delta code — a Delta-only roll still gets a code. */
function paperLabel(roll: MaterialRollListItem): string {
  const rt = rtCodes(roll);
  if (rt !== "—") return `RT ${rt}`;
  const delta = deltaCodes(roll);
  return delta !== "—" ? `Delta ${delta}` : "No paper code";
}

/** A roll's label reads the roll number; the small print is what tells two similar rolls
 *  apart on a rack. */
function rollLabel(roll: MaterialRollListItem): LabelItem {
  return {
    key: roll.id,
    code: roll.roll_number,
    lines: [
      `${paperLabel(roll)} · ${roll.gsm} gsm · ${roll.width} mm`,
      roll.location?.name ?? "-",
    ],
  };
}

export default function BarcodeGeneratorPage() {
  const { notify } = useToast();
  const [rolls, setRolls] = useState<MaterialRollListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // Selection is keyed by id and survives paging, so labels can be gathered from several
  // pages before printing one sheet.
  const [selected, setSelected] = useState<Record<string, MaterialRollListItem>>({});
  // Labels generated from a number range rather than picked from the list.
  const [seriesLabels, setSeriesLabels] = useState<LabelItem[]>([]);
  // Which kind the labels currently on the sheet actually are — set from the batch's own
  // saved kind when "View barcodes" is clicked, or from the current code-type setting when
  // a new run is generated. Never the live code-type setting directly: switching that
  // setting must not repaint an already-viewed run in the other kind.
  const [sheetKind, setSheetKind] = useState<LabelKind>("barcode");
  // The run whose widthMm/heightMm/kind apply to whatever's currently in `sheet` — needed
  // for "Print all" and each barcode's own Print button, since neither a freshly generated
  // series nor a saved run's labels carry that with them once expanded into LabelItems.
  const [activeBatch, setActiveBatch] = useState<BarcodeBatch | null>(null);
  // Which row on the left is lit up: a whole run ("batch:<id>") or one code out of a
  // global-search hit ("code:<code>") — kept as one key rather than two booleans so at
  // most one row is ever highlighted regardless of which list produced it.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // The global search box above the list — a code, a roll number, or a Royal Touche paper
  // code. Empty means "show every saved run," same as before this existed.
  const [globalQuery, setGlobalQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BarcodeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Saved runs, newest first — what was printed before, so a series can be reprinted or
  // the next start number picked without guessing.
  const [batches, setBatches] = useState<BarcodeBatch[]>([]);
  const [saving, setSaving] = useState(false);
  // Uppercased at the input, not at save time. CODE128 is case-sensitive, so a lowercase
  // prefix produced labels the backend then stored uppercase — reprinting the same run
  // gave a different barcode from the one already stuck on the roll.
  const [prefix, setPrefix] = useState("RT");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  // How many labels this run prints. Where it starts is not asked for — see nextStart.
  const [quantity, setQuantity] = useState("10");
  // The run awaiting a "yes" before it is removed from the list.
  const [deleting, setDeleting] = useState<BarcodeBatch | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  // Barcode or QR — set once per computer/printer, not per run of codes. Drives which
  // standard sizes are offered below, and how every print renders the code.
  const [labelKind] = useState<LabelKind>(loadLabelKind);
  // One size remembered per kind (see loadLabelSize) — switching kind swaps in that kind's
  // own last pick rather than carrying over a size that belongs to the other one.
  const [labelSize] = useState<LabelSizeMm>(() => loadLabelSize(loadLabelKind()));
  const labelWidthMm = labelSize.widthMm;
  const labelHeightMm = labelSize.heightMm;

  useEffect(() => {
    localStorage.setItem(LABEL_KIND_STORAGE_KEY, labelKind);
  }, [labelKind]);

  useEffect(() => {
    if (!ROLL_PICKER_ENABLED) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await rollsApi.list({ q: search || undefined, page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setRolls(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      } catch (err) {
        if (!cancelled) notify(apiErrorMessage(err), "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Debounced: this list is paginated server-side, so every keystroke is a real query.
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const loadBatches = async () => {
    try {
      const res = await barcodeBatchesApi.list({ pageSize: 50 });
      setBatches(res.items);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  useEffect(() => {
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced the same way nextNumber below is — the search box fires this on every
  // keystroke. An empty query clears the results rather than searching for "": the list
  // then falls back to `batches`, exactly like before this box existed.
  useEffect(() => {
    const query = globalQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    // Right side clears the moment a search starts, not once results come back — whatever
    // was open belonged to the plain list, and the list underneath it just changed to
    // search hits, so it shouldn't keep pointing at something no longer in view.
    setSeriesLabels([]);
    setActiveBatch(null);
    setActiveKey(null);
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const items = await barcodeBatchesApi.search(query);
        if (!cancelled) setSearchResults(items);
      } catch (err) {
        if (!cancelled) {
          setSearchResults([]);
          notify(apiErrorMessage(err), "error");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalQuery]);

  const toggle = (roll: MaterialRollListItem) =>
    setSelected((prev) => {
      if (prev[roll.id]) {
        const { [roll.id]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [roll.id]: roll };
    });

  const selectPage = () =>
    setSelected((prev) => ({ ...prev, ...Object.fromEntries(rolls.map((r) => [r.id, r])) }));

  // Series labels first: they're what you just asked for, so they shouldn't be buried
  // under a page of rolls selected earlier.
  const sheet: LabelItem[] = [...seriesLabels, ...Object.values(selected).map(rollLabel)];

  /**
   * Where this run starts — answered by the server, not counted from the runs on screen.
   *
   * A code is prefix + YYMMDD + sequence, so a number only has to be unique within one
   * prefix on one date. Working that out client-side meant reading the loaded runs, which
   * both stops at a page boundary and cannot see runs that were removed from the list —
   * and a removed run's labels are still on rolls in the godown.
   *
   * Nothing is typed here. Nobody knew the right start number without reading the saved
   * runs first, and getting it wrong reprinted codes already in use.
   */
  const [nextStart, setNextStart] = useState<number | null>(null);

  // Both are required for a run: the code is prefix + date + number. Shown under the field.
  const prefixError = prefix.trim() ? null : "Enter the letters the code starts with.";
  const dateError = date ? null : "Pick a date.";

  useEffect(() => {
    // Nothing to look up until both are filled — and asking anyway would 400 into a toast.
    if (prefixError || dateError) {
      setNextStart(null);
      return;
    }
    let cancelled = false;
    // Debounced: the prefix box fires this on every keystroke.
    const timer = setTimeout(async () => {
      try {
        const res = await barcodeBatchesApi.nextNumber({ prefix, date });
        if (!cancelled) setNextStart(res.next);
      } catch (err) {
        // Left null, which disables Generate — better than defaulting to 1 and reissuing
        // a number that is already on a roll.
        if (!cancelled) {
          setNextStart(null);
          notify(apiErrorMessage(err), "error");
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, date, batches]);

  const count = Number(quantity);
  // Over the cap is refused here rather than after the click. The preview used to promise
  // "501 labels: …" and only reveal the limit once the run had been submitted.
  const validCount = Number.isInteger(count) && count > 0 && count <= MAX_SERIES;
  // Null until the server says where to start; nothing can be generated before then.
  const canGenerate = validCount && !prefixError && !dateError && nextStart !== null && !saving;

  const seriesInput = {
    prefix,
    date,
    from: nextStart ?? 1,
    to: (nextStart ?? 1) + Math.max(count, 1) - 1,
  };
  const preview =
    !Number.isInteger(count) || count <= 0
      ? "Enter how many barcodes to print."
      : count > MAX_SERIES
        ? `That's ${count} barcodes — ${MAX_SERIES} at a time is the limit.`
        : nextStart === null
          ? "Checking which numbers are still free…"
          : `${count} barcode${count === 1 ? "" : "s"}: ${seriesCode(seriesInput, seriesInput.from)}` +
            (count > 1 ? ` to ${seriesCode(seriesInput, seriesInput.to)}` : "");

  /** "RT260910001-RT260910050" — the run's range, for the remove dialog's title. */
  const batchName = (batch: BarcodeBatch) => {
    const input = {
      prefix: batch.prefix,
      date: batch.date,
      from: batch.from_number,
      to: batch.to_number,
    };
    const first = seriesCode(input, batch.from_number);
    return batch.count > 1 ? `${first}-${seriesCode(input, batch.to_number)}` : first;
  };

  /** The codes of a saved run, rebuilt from its recipe — nothing is stored server-side. */
  const labelsOf = (batch: BarcodeBatch): LabelItem[] | null => {
    const result = buildSeries({
      prefix: batch.prefix,
      date: batch.date,
      from: batch.from_number,
      to: batch.to_number,
    });
    if (!result.ok) {
      notify(result.error, "error");
      return null;
    }
    return result.labels;
  };

  /** Show a whole run's barcodes on the right: replaces the sheet, so what's on screen is
   *  what "Print all" prints. */
  const viewBatch = (batch: BarcodeBatch) => {
    const labels = labelsOf(batch);
    if (!labels) return;
    setSeriesLabels(labels);
    setSheetKind(batch.kind);
    setActiveBatch(batch);
    setActiveKey(`batch:${batch.id}`);
    setSelected({});
  };

  /** Show just one code on the right — a global-search hit, never the whole run it came
   *  from. `batch` still supplies the widthMm/heightMm/kind this one code prints at. */
  const viewSingleCode = (batch: BarcodeBatch, code: string) => {
    setSeriesLabels([{ key: `search:${code}`, code, lines: [] }]);
    setSheetKind(batch.kind);
    setActiveBatch(batch);
    setActiveKey(`code:${code}`);
    setSelected({});
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingNow(true);
    try {
      await barcodeBatchesApi.remove(deleting.id);
      setBatches((prev) => prev.filter((b) => b.id !== deleting.id));
      // The panel on the right may be showing the run that just went; leaving it up
      // invites printing something no longer in the list.
      if (activeBatch?.id === deleting.id) {
        setSeriesLabels([]);
        setActiveBatch(null);
        setActiveKey(null);
      }
      setDeleting(null);
      notify("Barcodes removed from the list");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setDeletingNow(false);
    }
  };

  const addSeries = async () => {
    // The button is already disabled for these; checked again because the submit path is
    // what actually writes.
    if (prefixError || dateError) return;
    if (!validCount) {
      notify("Enter how many barcodes to print.", "error");
      return;
    }
    const result = buildSeries(seriesInput);
    if (!result.ok) {
      notify(result.error, "error");
      return;
    }
    // Saved first: if the write fails the labels don't silently exist only on this screen.
    setSaving(true);
    let saved: BarcodeBatch;
    try {
      saved = await barcodeBatchesApi.create({
        prefix,
        date,
        from_number: seriesInput.from,
        to_number: seriesInput.to,
        kind: labelKind,
        widthMm: labelWidthMm,
        heightMm: labelHeightMm,
      });
      setBatches((prev) => [saved, ...prev]);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
      setSaving(false);
      return;
    }
    setSaving(false);
    // Replaces rather than merges: the sheet shows exactly one run — the one just made, or
    // the one View was clicked on. Merging let two runs pile up invisibly, and printing a
    // range twice puts the same code on two rolls, which is unrecoverable in the godown.
    setSeriesLabels(result.labels);
    setSheetKind(labelKind);
    setActiveBatch(saved);
    setActiveKey(`batch:${saved.id}`);
    setSelected({});
    // Nothing to advance by hand any more: the saved run is now in `batches`, and nextStart
    // recomputes from it, so the next run already begins where this one ended.
    notify(`Generated ${result.labels.length} barcode${result.labels.length === 1 ? "" : "s"}`);
  };

  /**
   * Hand a set of labels to the browser's own print dialog instead of a downloaded file.
   *
   * Takes the labels directly rather than a batch, so the same path covers "every code in
   * this run" (Print all) and "just this one" (a single barcode's own Print button, or a
   * global-search hit) without duplicating the iframe dance for each.
   *
   * Rendered as plain HTML sized with `@page` (see printHtml.ts), not a PDF — a PDF's page
   * size gets reinterpreted by whichever PDF viewer prints it, and Chromium's built-in one
   * has a habit of auto-rotating a label-sized page no matter what the print dialog's own
   * orientation is set to. Printed via a hidden iframe rather
   * than a new tab: no popup blocker to fight, and it removes itself once the print dialog
   * closes instead of leaving an extra tab behind.
   */
  const printLabels = async (labels: LabelItem[], widthMm: number, heightMm: number, kind: LabelKind) => {
    if (labels.length === 0) return;
    const html = await buildPrintHtml(labels, widthMm, heightMm, kind);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const cleanup = () => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    };
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      notify("Couldn't open the print dialog", "error");
      return;
    }
    // afterprint fires whether the operator prints or cancels — either way the dialog is
    // done with this iframe, so it's the right moment to remove it.
    win.addEventListener("afterprint", cleanup);
    iframe.onload = () => {
      win.focus();
      win.print();
    };
    // srcdoc rather than document.write: it's the modern way to load a full HTML string into
    // an iframe, and content is already HTML-escaped in printHtml.ts either way.
    iframe.srcdoc = html;
  };

  return (
    <div className="list-page">
      <PageHeader
        title="Barcode generator"
        subtitle="Print barcodes for rolls that aren't in the system yet — stick them on first, scan them later."
      />

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>

        <div className="barcode-fields">
          <label className="barcode-field">
            <span>Letters at the start</span>
            <input
              className="input"
              placeholder="RT"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              aria-invalid={Boolean(prefixError) || undefined}
            />
            {prefixError && <small className="field-error">{prefixError}</small>}
          </label>
          <label className="barcode-field">
            <span>Date</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={Boolean(dateError) || undefined}
            />
            {dateError && <small className="field-error">{dateError}</small>}
          </label>
          <label className="barcode-field">
            <span>Quantity</span>
            <input
              className="input"
              type="number"
              min={1}
              max={MAX_SERIES}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        </div>

        <div className="row gap-8" style={{ marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-primary" onClick={addSeries} disabled={!canGenerate}>
            {saving ? "Saving…" : labelKind === "qr" ? "Generate QR codes" : "Generate barcodes"}
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            {preview}
          </span>
        </div>
      </div>

      {/* Searches a code directly, a roll number, or an RT or Delta paper code (which can
          span several rolls) — see barcodeBatchesService.search on the backend. Empty
          falls back to the plain list of saved runs below, exactly as before this existed. */}
      <div className="global-search" style={{ marginBottom: 14 }}>
        <Search size={16} className="global-search-icon" />
        <input
          className="global-search-input"
          placeholder="Search by code, roll number, RT code or Delta code"
          value={globalQuery}
          onChange={(e) => setGlobalQuery(e.target.value)}
        />
      </div>

      <div className="card barcode-history list-page-scroll">
        <div className="barcode-history-list">
          <div style={{ padding: "14px 14px 8px" }}>
            <strong style={{ fontSize: 13 }}>Generated barcodes</strong>
            <p className="faint" style={{ fontSize: 12, margin: "4px 0 0" }}>
              {searching
                ? "Searching…"
                : searchResults
                  ? `${searchResults.length} match${searchResults.length === 1 ? "" : "es"}`
                  : "Everything made here before — pick a run to print it again."}
            </p>
          </div>
          <div className="stack" style={{ gap: 4, padding: "0 10px 12px" }}>
            {searchResults ? (
              searchResults.length === 0 ? (
                <p className="faint" style={{ fontSize: 12, padding: "4px 6px" }}>
                  Nothing matches that.
                </p>
              ) : (
                searchResults.map((hit) => (
                  <div
                    key={`${hit.batch.id}:${hit.code}`}
                    className={`barcode-history-row${activeKey === `code:${hit.code}` ? " active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => viewSingleCode(hit.batch, hit.code)}
                    onKeyDown={(e) => e.key === "Enter" && viewSingleCode(hit.batch, hit.code)}
                  >
                    <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{hit.code}</div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {hit.roll
                        ? `Roll ${hit.roll.roll_number}${hit.roll.royal_touche_code ? ` · RT ${hit.roll.royal_touche_code}` : ""}${hit.roll.delta_code ? ` · Delta ${hit.roll.delta_code}` : ""}`
                        : `${hit.batch.kind === "qr" ? "QR code" : "Barcode"} · ${hit.batch.widthMm} x ${hit.batch.heightMm} mm`}
                    </div>
                  </div>
                ))
              )
            ) : batches.length === 0 ? (
              <p className="faint" style={{ fontSize: 12, padding: "4px 6px" }}>
                Nothing saved yet.
              </p>
            ) : (
              batches.map((batch) => (
                <div
                  key={batch.id}
                  className={`barcode-history-row${activeKey === `batch:${batch.id}` ? " active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => viewBatch(batch)}
                  onKeyDown={(e) => e.key === "Enter" && viewBatch(batch)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {seriesCode(
                        { prefix: batch.prefix, date: batch.date, from: batch.from_number, to: batch.to_number },
                        batch.from_number,
                      )}
                      {batch.count > 1 && " – "}
                      {batch.count > 1 &&
                        seriesCode(
                          { prefix: batch.prefix, date: batch.date, from: batch.from_number, to: batch.to_number },
                          batch.to_number,
                        )}
                    </div>
                    <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                      {batch.count} {batch.kind === "qr" ? "QR code" : "barcode"}
                      {batch.count === 1 ? "" : "s"} · {batch.createdBy} ·{" "}
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(batch);
                    }}
                    title="Remove this run from the list"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="barcode-history-panel">
          <div className="row gap-8" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="faint" style={{ fontSize: 12 }}>
              {sheet.length === 0
                ? "Nothing selected"
                : `${sheet.length} ${sheetKind === "qr" ? "QR code" : "barcode"}${sheet.length === 1 ? "" : "s"}`}
            </span>
            {sheet.length > 0 && activeBatch && (
              <div className="row gap-8">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => printLabels(sheet, activeBatch.widthMm, activeBatch.heightMm, activeBatch.kind)}
                  title="Print every barcode shown here through your browser's own print dialog"
                >
                  <Send size={14} /> Print all
                </button>
              </div>
            )}
          </div>
          {sheet.length === 0 ? (
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              Pick a run on the left, or search above, to see its barcodes here.
            </p>
          ) : (
            <div className="barcode-sheet">
              {sheet.map((item) => (
                <div key={item.key} className="barcode-label-slot">
                  <div className="barcode-card">
                    <Label item={item} kind={sheetKind} />
                    {activeBatch && (
                      <button
                        className="barcode-card-print"
                        onClick={() =>
                          printLabels([item], activeBatch.widthMm, activeBatch.heightMm, activeBatch.kind)
                        }
                        title="Print just this barcode"
                      >
                        <Send size={12} /> Print
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="barcode-controls">
        {ROLL_PICKER_ENABLED && (
          <div className="row gap-8" style={{ marginBottom: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Search by roll number, RT code or batch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn" onClick={selectPage} disabled={rolls.length === 0}>
              Select page
            </button>
          </div>
        )}

        {ROLL_PICKER_ENABLED && (
        <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
          {loading ? (
            <Spinner />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}></th>
                    <th>Roll number</th>
                    <th>RT code</th>
                    <th>Delta code</th>
                    <th>GSM</th>
                    <th>Width</th>
                    <th>Location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rolls.map((roll) => (
                    <tr key={roll.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[roll.id])}
                          onChange={() => toggle(roll)}
                        />
                      </td>
                      <td style={{ fontWeight: 600 }}>{roll.roll_number}</td>
                      <td>{rtCodes(roll)}</td>
                      <td>{deltaCodes(roll)}</td>
                      <td>{roll.gsm}</td>
                      <td>{roll.width}</td>
                      <td>{roll.location?.name ?? "-"}</td>
                      <td>{roll.status}</td>
                    </tr>
                  ))}
                  {rolls.length === 0 && (
                    <tr>
                      <td colSpan={8} className="faint" style={{ textAlign: "center", padding: 20 }}>
                        No rolls match that search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div
                className="row gap-8"
                style={{ justifyContent: "space-between", padding: "10px 12px" }}
              >
                <span className="faint" style={{ fontSize: 12 }}>
                  {total} roll{total === 1 ? "" : "s"} · {sheet.length} selected
                </span>
                <div className="row gap-8">
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Prev
                  </button>
                  <span className="faint" style={{ fontSize: 12 }}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      <Modal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Remove ${batchName(deleting)}?` : "Remove run"}
        size="medium"
      >
        {deleting && (
          <div style={{ display: "grid", gap: 14, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              This takes the run off the list. The barcodes it covers stay used —{" "}
              <strong>they will never be given out again</strong>, because labels from this
              run may already be stuck on rolls.
            </p>
            <div className="facts-grid">
              <div>
                <span className="faint">Labels</span>
                <strong>{deleting.count}</strong>
              </div>
              <div>
                <span className="faint">Printed by</span>
                <strong>{deleting.createdBy}</strong>
              </div>
              <div>
                <span className="faint">On</span>
                <strong>{new Date(deleting.createdAt).toLocaleDateString()}</strong>
              </div>
            </div>
            <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmDelete}
                disabled={deletingNow}
              >
                {deletingNow ? "Removing…" : "Remove barcodes"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
