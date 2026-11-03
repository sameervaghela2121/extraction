import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { apiErrorMessage } from "../../api/client";
import { reportsApi } from "../../api/reports.api";
import { useToast } from "../../context/ToastContext";

/** en-CA formats as YYYY-MM-DD, in the local day rather than UTC's. */
const today = () => new Date().toLocaleDateString("en-CA");

/**
 * The daily report: one CSV row for each roll that moved on a date, as it stood after its last
 * movement that day. A roll with no movement that day is not in it.
 */
export default function DailyRollReportPage() {
  const { notify } = useToast();
  const [date, setDate] = useState(today);
  // Null while the day's count is loading, or when it could not be read.
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCount(null);
    if (!date) return;
    // Only the latest date's answer counts, if an earlier request lands after it.
    let current = true;
    reportsApi
      .dailyRollsCount(date)
      .then((n) => current && setCount(n))
      .catch((err) => current && notify(apiErrorMessage(err), "error"));
    return () => {
      current = false;
    };
  }, [date, notify]);

  const download = async () => {
    setBusy(true);
    try {
      await reportsApi.downloadDailyRolls(date);
      notify("Report downloaded");
    } catch (err) {
      notify(apiErrorMessage(err, "The report could not be downloaded"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ padding: 20, maxWidth: 640 }}>
        <label className="field-label" htmlFor="report-date">Date</label>
        <input
          id="report-date"
          className="input"
          type="date"
          max={today()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        <div className="row gap-12" style={{ marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={download} disabled={busy || !date || !count}>
            <Download size={14} />
            {busy ? "Downloading…" : "Download CSV"}
          </button>
          {count === 0 && <span className="faint">No rolls moved on that date</span>}
          {count != null && count > 0 && (
            <span className="pill pill-archived">{count} roll{count === 1 ? "" : "s"} moved</span>
          )}
        </div>
      </div>
    </div>
  );
}
