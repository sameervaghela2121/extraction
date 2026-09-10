import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Printer, X } from "lucide-react";
import { rollsApi } from "../../api/rolls.api";
import { apiErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Label, { barPattern, type LabelItem } from "./Label";
import { buildSeries, seriesCode, MAX_SERIES } from "./series";
import { buildLabelPdf, type PdfLabel } from "./pdf";
import { buildZpl } from "./zpl";
import { barcodeBatchesApi } from "../../api/barcodeBatches.api";
import type { BarcodeBatch, MaterialRollListItem } from "../../types";

const PAGE_SIZE = 25;
// ponytail: the roll picker is built and working, just not wanted on screen yet. Flip to
// true to bring back the search, the "Select page" button and the roll table.
const ROLL_PICKER_ENABLED = false;

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
    if (labels.length === 0) return;
    // One 100x50mm page per label, drawn as vectors — the page IS the sticker, so a
    // thermal printer feeds one per label with nothing to scale or cut.
    const pages: PdfLabel[] = labels.map((label) => ({
      bars: barPattern(label.code),
      code: label.code,
      lines: label.lines,
    }));
    const url = URL.createObjectURL(buildLabelPdf(pages));
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
    const labels = labelsOf(batch);
    if (!labels) return;
    const blob = new Blob([buildZpl(labels)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${batchName(batch)}.zpl`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`${labels.length} barcode${labels.length === 1 ? "" : "s"} ready for the printer`);
  };

  return (
    <div>
      <PageHeader
        title="Barcode generator"
        subtitle="Print barcodes for rolls that aren't in the system yet — stick them on first, scan them later."
      />

      <div className="barcode-layout">
      <div className="barcode-controls">
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
                  <button className="btn btn-sm" onClick={() => viewBatch(batch)}>
                    <Eye size={14} /> View barcodes
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => downloadBatchZpl(batch)}
                    title="Send this run to the label printer"
                  >
                    <Printer size={14} /> Print file
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => downloadBatch(batch)}
                    title="Download this run as a PDF"
                  >
                    <Download size={14} /> PDF
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setDeleting(batch)}
                    title="Remove this run from the list"
                  >
                    <X size={14} />
                  </button>
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
    </div>
  );
}
