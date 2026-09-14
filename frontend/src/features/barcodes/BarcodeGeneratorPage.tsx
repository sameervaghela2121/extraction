import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Printer, Send, X } from "lucide-react";
import { rollsApi } from "../../api/rolls.api";
import { apiErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Label, { barPattern, type LabelItem } from "./Label";
import { buildSeries, seriesCode, MAX_SERIES } from "./series";
import { buildLabelPdf, type PdfLabel } from "./pdf";
import { buildZpl } from "./zpl";
import { listPrinters, printRaw } from "./qzPrint";
import { barcodeBatchesApi } from "../../api/barcodeBatches.api";
import type { BarcodeBatch, MaterialRollListItem } from "../../types";

const PAGE_SIZE = 25;
// ponytail: the roll picker is built and working, just not wanted on screen yet. Flip to
// true to bring back the search, the "Select page" button and the roll table.
const ROLL_PICKER_ENABLED = false;

/** Same barcode peeled off twice — one goes on each of two packages, so it needs to exist
 *  twice on the roll, back to back, rather than once. The PDF and ZPL downloads always use
 *  this; direct printing lets the operator choose instead (see PrinterSettings below). */
const COPIES_PER_LABEL = 2;

function duplicateForPrint(labels: LabelItem[], copies: number = COPIES_PER_LABEL): LabelItem[] {
  return labels.flatMap((label) => Array<LabelItem>(copies).fill(label));
}

interface PrinterSettings {
  /** Exactly as QZ Tray reports it — this is a driver/queue name, not something to guess. */
  name: string;
  /** Dots per mm the selected printer actually is: 203dpi = 8, 300dpi = 12. Wrong here means
   *  every measurement in the ZPL — label size, bars, margins, fonts — comes out scaled to
   *  the wrong physical size on that printer. */
  dpi: 203 | 300;
  copies: "1" | "2";
}

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = { name: "", dpi: 203, copies: "2" };
const PRINTER_SETTINGS_STORAGE_KEY = "barcode-printer-settings";

/** Remembered per browser, same reasoning as the sticker size: one computer, one printer. */
function loadPrinterSettings(): PrinterSettings {
  try {
    const raw = localStorage.getItem(PRINTER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_SETTINGS;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.name === "string" &&
      (parsed.dpi === 203 || parsed.dpi === 300) &&
      (parsed.copies === "1" || parsed.copies === "2")
    ) {
      return parsed;
    }
  } catch {
    // Corrupt or blocked storage — fall back to the default rather than fail the page.
  }
  return DEFAULT_PRINTER_SETTINGS;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Same tag qzPrint.ts logs under — filter DevTools' console on "[barcode-print]" to see
 *  the whole direct-print flow in one place, from dialog open through the QZ Tray reply. */
const LOG = "[barcode-print]";

interface LabelSizeMm {
  width: string;
  height: string;
}

/** The 100 x 50mm label this page always printed before custom sizing existed. */
const DEFAULT_LABEL_SIZE: LabelSizeMm = { width: "100", height: "50" };
const LABEL_SIZE_STORAGE_KEY = "barcode-label-size-mm";
const MIN_LABEL_MM = 10;
const MAX_LABEL_MM = 300;

/** Remembered per browser, not per batch — a computer is wired to one printer loaded with
 *  one roll, so the size is a setting of this screen, not a fact about any run of codes. */
function loadLabelSize(): LabelSizeMm {
  try {
    const raw = localStorage.getItem(LABEL_SIZE_STORAGE_KEY);
    if (!raw) return DEFAULT_LABEL_SIZE;
    const parsed = JSON.parse(raw);
    if (typeof parsed.width === "string" && typeof parsed.height === "string") return parsed;
  } catch {
    // Corrupt or blocked storage — fall back to the default rather than fail the page.
  }
  return DEFAULT_LABEL_SIZE;
}

/** A roll's label reads the roll number; the small print is what tells two similar rolls
 *  apart on a rack. */
function rollLabel(roll: MaterialRollListItem): LabelItem {
  return {
    key: roll.id,
    code: roll.roll_number,
    lines: [
      `${roll.royal_touche_code ? `RT ${roll.royal_touche_code}` : "No RT code"} · ${roll.gsm} gsm · ${roll.width} mm`,
      roll.location,
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
  // The physical sticker size — set once per computer/printer, not per run of codes.
  const [labelSize, setLabelSize] = useState<LabelSizeMm>(loadLabelSize);
  const labelWidthMm = Number(labelSize.width);
  const labelHeightMm = Number(labelSize.height);
  const validLabelSize =
    Number.isFinite(labelWidthMm) &&
    labelWidthMm >= MIN_LABEL_MM &&
    labelWidthMm <= MAX_LABEL_MM &&
    Number.isFinite(labelHeightMm) &&
    labelHeightMm >= MIN_LABEL_MM &&
    labelHeightMm <= MAX_LABEL_MM;

  useEffect(() => {
    // Only a size that will actually print is worth remembering — an in-progress edit
    // (like a cleared field) shouldn't overwrite the last size that worked.
    if (!validLabelSize) return;
    try {
      localStorage.setItem(LABEL_SIZE_STORAGE_KEY, JSON.stringify(labelSize));
    } catch {
      // Best effort — printing still works even if the size isn't remembered next visit.
    }
  }, [labelSize, validLabelSize]);

  // Direct printing via QZ Tray — see qzPrint.ts. Nothing here talks to the backend.
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(loadPrinterSettings);
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [detectingPrinters, setDetectingPrinters] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);
  // The run "Print directly" was clicked for — non-null opens the dialog. Detection and
  // settings happen inside it rather than on a permanently-visible card, since they're only
  // ever relevant at the moment you're about to print.
  const [printDialogBatch, setPrintDialogBatch] = useState<BarcodeBatch | null>(null);
  const [sendingPrint, setSendingPrint] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PRINTER_SETTINGS_STORAGE_KEY, JSON.stringify(printerSettings));
    } catch {
      // Best effort — printing still works even if the choice isn't remembered next visit.
    }
  }, [printerSettings]);

  // The saved printer name from last time won't be in the list until detection runs again
  // this session — keep it selectable anyway rather than silently blanking it.
  const printerOptions =
    printerSettings.name && !availablePrinters.includes(printerSettings.name)
      ? [printerSettings.name, ...availablePrinters]
      : availablePrinters;

  const detectPrinters = async () => {
    console.log(`${LOG} detecting printers…`);
    setDetectingPrinters(true);
    setPrinterError(null);
    try {
      const found = await listPrinters();
      setAvailablePrinters(found);
      if (found.length === 0) {
        console.warn(`${LOG} QZ Tray connected but reported zero printers`);
        setPrinterError("QZ Tray is running but sees no printers — check it's installed and turned on.");
      } else if (!found.includes(printerSettings.name)) {
        console.log(`${LOG} auto-selecting "${found[0]}" (previous selection not in this list)`);
        setPrinterSettings((prev) => ({ ...prev, name: found[0] }));
      } else {
        console.log(`${LOG} keeping existing selection "${printerSettings.name}"`);
      }
    } catch (err) {
      console.error(`${LOG} detection failed`, err);
      setPrinterError(`Couldn't reach QZ Tray — install it and make sure it's running. (${errorMessage(err)})`);
    } finally {
      setDetectingPrinters(false);
    }
  };

  /** Opens the print dialog for this run and immediately starts looking for a printer, so
   *  by the time the operator has read the dialog a printer is usually already selected. */
  const openPrintDialog = (batch: BarcodeBatch) => {
    console.log(`${LOG} opening print dialog for batch ${batchName(batch)} (${batch.count} barcodes)`);
    setPrintDialogBatch(batch);
    setPrinterError(null);
    void detectPrinters();
  };

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

  useEffect(() => {
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
  const canGenerate = validCount && nextStart !== null && !saving;

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

  /**
   * Which saved runs are already on the sheet.
   *
   * Checked by first and last code rather than by expanding every run: 50 runs of up to 500
   * labels is 25,000 strings to rebuild on each render, and a run only ever goes on as a
   * whole — addBatch merges the entire range at once — so its two ends answer the question.
   */
  const sheetKeys = useMemo(() => new Set(seriesLabels.map((l) => l.key)), [seriesLabels]);

  const isOnSheet = (batch: BarcodeBatch) => {
    const input = {
      prefix: batch.prefix,
      date: batch.date,
      from: batch.from_number,
      to: batch.to_number,
    };
    return (
      sheetKeys.has(`series:${seriesCode(input, batch.from_number)}`) &&
      sheetKeys.has(`series:${seriesCode(input, batch.to_number)}`)
    );
  };

  /** "RT260910001-RT260910050" — the run's range, for the row heading and the filename. */
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

  /** Show just this run: replaces the sheet, so what's on screen is what downloads. */
  const viewBatch = (batch: BarcodeBatch) => {
    const labels = labelsOf(batch);
    if (!labels) return;
    setSeriesLabels(labels);
    setSelected({});
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingNow(true);
    try {
      await barcodeBatchesApi.remove(deleting.id);
      setBatches((prev) => prev.filter((b) => b.id !== deleting.id));
      // The preview may be showing the run that just went; leaving it up invites a
      // download of something no longer in the list.
      if (isOnSheet(deleting)) setSeriesLabels([]);
      setDeleting(null);
      notify("Barcodes removed from the list");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setDeletingNow(false);
    }
  };

  const addSeries = async () => {
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
    try {
      const saved = await barcodeBatchesApi.create({
        prefix,
        date,
        from_number: seriesInput.from,
        to_number: seriesInput.to,
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
    setSelected({});
    // Nothing to advance by hand any more: the saved run is now in `batches`, and nextStart
    // recomputes from it, so the next run already begins where this one ended.
    notify(`Generated ${result.labels.length} barcode${result.labels.length === 1 ? "" : "s"}`);
  };

  /** Labels → a PDF in the browser's downloads. `name` becomes the filename, so a run
   *  arrives as "RT260910001-RT260910050.pdf" rather than something anonymous. */
  const downloadLabels = (labels: LabelItem[], name: string) => {
    if (labels.length === 0 || !validLabelSize) return;
    // One page per label, drawn as vectors at the configured sticker size — the page IS
    // the sticker, so a thermal printer feeds one per label with nothing to scale or cut.
    // Each barcode is duplicated so the same code can be stuck on two different packages.
    const pages: PdfLabel[] = duplicateForPrint(labels).map((label) => ({
      bars: barPattern(label.code),
      code: label.code,
      lines: label.lines,
    }));
    const url = URL.createObjectURL(buildLabelPdf(pages, labelWidthMm, labelHeightMm));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`${pages.length} barcode${pages.length === 1 ? "" : "s"} downloaded`);
  };

  /** Download a saved run straight from its row — no need to preview it first. */
  const downloadBatch = (batch: BarcodeBatch) => {
    const labels = labelsOf(batch);
    if (!labels) return;
    downloadLabels(labels, batchName(batch));
  };

  /**
   * The same run as printer commands rather than a document.
   *
   * Plain text, so it can go to the printer however the office finds easiest — dragged into
   * the printer's utility, or copied to its share. The browser has to produce this rather
   * than the server: the printer sits on their LAN and the backend runs in Cloud Run, so
   * the two can never reach each other.
   */
  const downloadBatchZpl = (batch: BarcodeBatch) => {
    if (!validLabelSize) return;
    const labels = labelsOf(batch);
    if (!labels) return;
    // Duplicated for the same reason the PDF path is: two identical stickers per code, one
    // for each package.
    const printLabels = duplicateForPrint(labels);
    const blob = new Blob([buildZpl(printLabels, labelWidthMm, labelHeightMm)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${batchName(batch)}.zpl`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`${printLabels.length} barcode${printLabels.length === 1 ? "" : "s"} ready for the printer`);
  };

  /**
   * The "Print" button inside the dialog opened by "Print directly".
   *
   * Detection already ran when the dialog opened (see openPrintDialog), so this just sends
   * whatever printer/resolution/copies are currently set in the dialog. On failure the
   * dialog stays open with the error shown in it, so a fixable problem (wrong printer
   * picked, QZ Tray not started yet) can be corrected and retried without starting over.
   *
   * Resolves once QZ Tray accepts the job, not once the sticker is physically out of the
   * printer — a jam or empty stock still reports success here, same caveat as any print
   * dialog. The PDF/ZPL downloads stay available on this row as the fallback/reprint path.
   */
  const confirmPrint = async () => {
    const batch = printDialogBatch;
    if (!batch || !validLabelSize || !printerSettings.name) {
      console.warn(`${LOG} Print clicked with nothing to print`, {
        hasBatch: Boolean(batch),
        validLabelSize,
        printerName: printerSettings.name,
      });
      return;
    }
    const labels = labelsOf(batch);
    if (!labels) return;
    console.log(`${LOG} confirmed print`, {
      batch: batchName(batch),
      printer: printerSettings.name,
      dpi: printerSettings.dpi,
      copies: printerSettings.copies,
      stickerSizeMm: `${labelWidthMm}x${labelHeightMm}`,
      uniqueBarcodes: labels.length,
    });
    setSendingPrint(true);
    setPrinterError(null);
    try {
      const printLabels = duplicateForPrint(labels, Number(printerSettings.copies));
      await printRaw(
        printerSettings.name,
        buildZpl(printLabels, labelWidthMm, labelHeightMm, printerSettings.dpi),
      );
      console.log(`${LOG} print succeeded — ${printLabels.length} labels sent`);
      notify(
        `${printLabels.length} barcode${printLabels.length === 1 ? "" : "s"} sent to ${printerSettings.name}`,
      );
      setPrintDialogBatch(null);
    } catch (err) {
      console.error(`${LOG} print failed`, err);
      setPrinterError(`Couldn't print — is QZ Tray running and the printer on? (${errorMessage(err)})`);
    } finally {
      setSendingPrint(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Barcode generator"
        subtitle="Print barcodes for rolls that aren't in the system yet — stick them on first, scan them later."
      />

      <div className="barcode-layout">
      <div className="barcode-controls">
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <strong style={{ fontSize: 13 }}>Sticker size</strong>
          <p className="faint" style={{ fontSize: 12, margin: "4px 0 12px" }}>
            Match the roll loaded in your barcode printer — used for both the PDF and the
            print file. Remembered on this computer.
          </p>
          <div className="barcode-fields">
            <label className="barcode-field">
              <span>Width (mm)</span>
              <input
                className="input"
                type="number"
                min={MIN_LABEL_MM}
                max={MAX_LABEL_MM}
                value={labelSize.width}
                onChange={(e) => setLabelSize((prev) => ({ ...prev, width: e.target.value }))}
              />
            </label>
            <label className="barcode-field">
              <span>Height (mm)</span>
              <input
                className="input"
                type="number"
                min={MIN_LABEL_MM}
                max={MAX_LABEL_MM}
                value={labelSize.height}
                onChange={(e) => setLabelSize((prev) => ({ ...prev, height: e.target.value }))}
              />
            </label>
          </div>
          {!validLabelSize && (
            <p style={{ color: "var(--danger)", fontSize: 12, margin: "8px 0 0" }}>
              Enter a width and height between {MIN_LABEL_MM} and {MAX_LABEL_MM}mm.
            </p>
          )}
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <strong style={{ fontSize: 14 }}>Make blank barcodes</strong>
          <p className="faint" style={{ fontSize: 12, margin: "4px 0 12px" }}>
            For rolls that don't exist in the system yet — stick these on first, scan them later.
          </p>

          <div className="barcode-fields">
            <label className="barcode-field">
              <span>Letters at the start</span>
              <input
                className="input"
                placeholder="RT"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              />
            </label>
            <label className="barcode-field">
              <span>Date</span>
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
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
              {saving ? "Saving…" : "Generate barcodes"}
            </button>
            <span className="faint" style={{ fontSize: 12 }}>
              {preview}
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="row gap-8" style={{ marginBottom: 10, alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>Generated barcodes</strong>
            <span className="faint" style={{ fontSize: 12 }}>
              Everything made here before — open a run to print it again.
            </span>
          </div>
          {batches.length === 0 ? (
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              Nothing saved yet.
            </p>
          ) : (
            <div className="stack" style={{ gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className={`barcode-run${isOnSheet(batch) ? " selected" : ""}`}
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
                    <div className="faint" style={{ fontSize: 12 }}>
                      {batch.count} barcode{batch.count === 1 ? "" : "s"} · {batch.createdBy} ·{" "}
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="spacer" />
                  <div className="barcode-run-actions">
                    <button className="btn btn-sm" onClick={() => viewBatch(batch)}>
                      <Eye size={14} /> View barcodes
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => downloadBatchZpl(batch)}
                      disabled={!validLabelSize}
                      title={
                        validLabelSize
                          ? "Send this run to the label printer"
                          : "Enter a valid sticker size first"
                      }
                    >
                      <Printer size={14} /> Print file
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => downloadBatch(batch)}
                      disabled={!validLabelSize}
                      title={validLabelSize ? "Download this run as a PDF" : "Enter a valid sticker size first"}
                    >
                      <Download size={14} /> PDF
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => openPrintDialog(batch)}
                      disabled={!validLabelSize}
                      title={
                        validLabelSize
                          ? "Send this run straight to the printer over QZ Tray, skipping the file/dialog"
                          : "Enter a valid sticker size first"
                      }
                    >
                      <Send size={14} /> Print directly
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setDeleting(batch)}
                      title="Remove this run from the list"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
                      <td>{roll.royal_touche_code ?? "—"}</td>
                      <td>{roll.gsm}</td>
                      <td>{roll.width}</td>
                      <td>{roll.location}</td>
                      <td>{roll.status}</td>
                    </tr>
                  ))}
                  {rolls.length === 0 && (
                    <tr>
                      <td colSpan={7} className="faint" style={{ textAlign: "center", padding: 20 }}>
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

      <div className="barcode-sheet-wrap">
        <h2 style={{ fontSize: 15, margin: "0 0 10px" }} className="barcode-controls">
          Ready to print ({sheet.length})
        </h2>
        {sheet.length === 0 ? (
          <p className="faint barcode-controls" style={{ fontSize: 12, margin: 0 }}>
            Generate a run above, or open a saved one — the barcodes appear here.
          </p>
        ) : (
          <div className="barcode-sheet">
            {sheet.map((item) => (
              <div key={item.key} className="barcode-label-slot">
                <Label item={item} />
              </div>
            ))}
          </div>
        )}
      </div>
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

      <Modal
        isOpen={printDialogBatch !== null}
        onClose={() => setPrintDialogBatch(null)}
        title={printDialogBatch ? `Print ${batchName(printDialogBatch)} directly` : "Print directly"}
        size="medium"
      >
        {printDialogBatch && (
          <div style={{ display: "grid", gap: 14, padding: 16 }}>
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              {detectingPrinters
                ? "Looking for a printer via QZ Tray…"
                : printerSettings.name
                  ? `Found "${printerSettings.name}". Change any of these if it's not what you want.`
                  : "No printer picked yet — install and start QZ Tray on this computer, then detect again."}
            </p>
            <label className="barcode-field">
              <span>Printer</span>
              <select
                className="input"
                value={printerSettings.name}
                onChange={(e) => setPrinterSettings((prev) => ({ ...prev, name: e.target.value }))}
              >
                <option value="">Select a printer…</option>
                {printerOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <div className="barcode-fields">
              <label className="barcode-field">
                <span>Printer resolution</span>
                <select
                  className="input"
                  value={printerSettings.dpi}
                  onChange={(e) =>
                    setPrinterSettings((prev) => ({
                      ...prev,
                      dpi: Number(e.target.value) === 300 ? 300 : 203,
                    }))
                  }
                >
                  <option value={203}>203 dpi (TH240)</option>
                  <option value={300}>300 dpi (TH340)</option>
                </select>
              </label>
              <label className="barcode-field">
                <span>Copies per barcode</span>
                <select
                  className="input"
                  value={printerSettings.copies}
                  onChange={(e) =>
                    setPrinterSettings((prev) => ({
                      ...prev,
                      copies: e.target.value === "1" ? "1" : "2",
                    }))
                  }
                >
                  <option value="1">1 (one sticker each)</option>
                  <option value="2">2 (for two packages)</option>
                </select>
              </label>
            </div>
            <div className="row gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={detectPrinters} disabled={detectingPrinters}>
                {detectingPrinters ? "Looking…" : "Detect again"}
              </button>
              {printerError && (
                <span style={{ color: "var(--danger)", fontSize: 12 }}>{printerError}</span>
              )}
            </div>
            <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setPrintDialogBatch(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmPrint}
                disabled={sendingPrint || !printerSettings.name}
              >
                {sendingPrint ? "Sending…" : "Print"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
