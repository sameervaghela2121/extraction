import { useEffect, useState } from "react";
import { Download, Eye, X } from "lucide-react";
import { rollsApi } from "../../api/rolls.api";
import { apiErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { PageHeader, Spinner } from "../../components/ui";
import Label, { renderLabel, renderSheet, type LabelItem } from "./Label";
import { buildSeries, seriesCode } from "./series";
import { buildPdf, dataUrlToBytes, type PdfPage } from "./pdf";
import { barcodeBatchesApi } from "../../api/barcodeBatches.api";
import type { BarcodeBatch, MaterialRollListItem } from "../../types";

const PAGE_SIZE = 25;
// ponytail: the roll picker is built and working, just not wanted on screen yet. Flip to
// true to bring back the search, the "Select page" button and the roll table.
const ROLL_PICKER_ENABLED = false;

/** Labels per A4 page in the downloaded PDF — 2 columns of 7, which is what fits once
 *  the sheet is scaled to the page width. */
const LABELS_PER_PAGE = 14;

/** Render one label to a PNG and hand it to the browser. Done off-screen rather than by
 *  reading the printed label's canvas, so a download works before anything is selected in
 *  view and always comes out at full resolution. */
function downloadPng(item: LabelItem): void {
  const canvas = renderLabel(item);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${item.code}.png`;
  link.click();
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
  const [prefix, setPrefix] = useState("RT");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("10");

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

  const seriesInput = { prefix, date, from: Number(from), to: Number(to) };
  const seriesCount = Number(to) - Number(from) + 1;
  const preview =
    seriesCount > 0
      ? `${seriesCount} label${seriesCount === 1 ? "" : "s"}: ${seriesCode(seriesInput, Number(from))}` +
        (seriesCount > 1 ? ` to ${seriesCode(seriesInput, Number(to))}` : "")
      : "Enter a start and end number.";

  // Merge by code so re-adding an overlapping range tops it up instead of printing the
  // same label twice.
  const mergeLabels = (labels: LabelItem[]) =>
    setSeriesLabels((prev) => {
      const byKey = new Map(prev.map((l) => [l.key, l]));
      for (const label of labels) byKey.set(label.key, label);
      return [...byKey.values()];
    });

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

  const addBatch = (batch: BarcodeBatch) => {
    const labels = labelsOf(batch);
    if (!labels) return;
    mergeLabels(labels);
    notify(`${labels.length} label${labels.length === 1 ? "" : "s"} added`);
  };

  const deleteBatch = async (batch: BarcodeBatch) => {
    try {
      await barcodeBatchesApi.remove(batch.id);
      setBatches((prev) => prev.filter((b) => b.id !== batch.id));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  const addSeries = async () => {
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
        from_number: Number(from),
        to_number: Number(to),
      });
      setBatches((prev) => [saved, ...prev]);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
      setSaving(false);
      return;
    }
    setSaving(false);
    mergeLabels(result.labels);
    // Move the range on by its own length, so the next run continues where this one ended
    // instead of reprinting the same numbers — the easiest mistake to make on this screen.
    setFrom(String(Number(to) + 1));
    setTo(String(Number(to) + result.labels.length));
    notify(`Saved — ${result.labels.length} label${result.labels.length === 1 ? "" : "s"} on the sheet`);
  };

  const downloadSheet = () => {
    // One A4 page per chunk: paging here
    // rather than scaling the whole sheet down keeps every barcode the same size.
    const pages: PdfPage[] = [];
    for (let start = 0; start < sheet.length; start += LABELS_PER_PAGE) {
      const canvas = renderSheet(sheet.slice(start, start + LABELS_PER_PAGE));
      pages.push({
        jpeg: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)),
        width: canvas.width,
        height: canvas.height,
      });
    }
    const url = URL.createObjectURL(buildPdf(pages));
    const link = document.createElement("a");
    link.href = url;
    link.download = `label-sheet-${sheet.length}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`${pages.length} page${pages.length === 1 ? "" : "s"} downloaded`);
  };

  return (
    <div>
      <PageHeader
        title="Barcode generator"
        subtitle="Make labels for rolls that aren't in the system yet, then download them as a PDF sheet."
      />

      <div className="barcode-layout">
      <div className="barcode-controls">
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <strong style={{ fontSize: 14 }}>Make blank labels</strong>
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
                onChange={(e) => setPrefix(e.target.value)}
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
              <span>Start number</span>
              <input
                className="input"
                type="number"
                min={0}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="barcode-field">
              <span>End number</span>
              <input
                className="input"
                type="number"
                min={0}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>

          <div className="row gap-8" style={{ marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-primary" onClick={addSeries} disabled={saving}>
              {saving ? "Saving…" : "Save & add to sheet"}
            </button>
            <span className="faint" style={{ fontSize: 12 }}>
              {preview}
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="row gap-8" style={{ marginBottom: 10, alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>Saved label runs</strong>
            <span className="faint" style={{ fontSize: 12 }}>
              Everything made here before — add a run back to the sheet to print it again.
            </span>
          </div>
          {batches.length === 0 ? (
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              Nothing saved yet.
            </p>
          ) : (
            <div className="stack" style={{ gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {batches.map((batch) => (
                <div key={batch.id} className="barcode-run">
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
                      {batch.count} label{batch.count === 1 ? "" : "s"} · {batch.createdBy} ·{" "}
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="spacer" />
                  <button className="btn btn-sm" onClick={() => viewBatch(batch)}>
                    <Eye size={14} /> View sheet
                  </button>
                  <button className="btn btn-sm" onClick={() => addBatch(batch)}>
                    Add to sheet
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => deleteBatch(batch)}
                    title="Delete this run"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="row gap-8" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          {ROLL_PICKER_ENABLED && (
            <>
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
            </>
          )}
          <button
            className="btn"
            onClick={() => {
              setSelected({});
              setSeriesLabels([]);
            }}
            disabled={sheet.length === 0}
          >
            Clear ({sheet.length})
          </button>
          <button className="btn btn-primary" onClick={downloadSheet} disabled={sheet.length === 0}>
            <Download size={15} /> Download sheet (PDF)
          </button>
        </div>

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
          Label sheet ({sheet.length})
        </h2>
        {sheet.length === 0 ? (
          <p className="faint barcode-controls" style={{ fontSize: 12, margin: 0 }}>
            Make some labels above — they appear here as you add them.
          </p>
        ) : (
          <div className="barcode-sheet">
            {sheet.map((item) => (
              <div key={item.key} className="barcode-label-slot">
                <Label item={item} />
                <button
                  className="btn btn-sm btn-ghost barcode-controls"
                  onClick={() => downloadPng(item)}
                >
                  <Download size={13} /> PNG
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
