import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { fieldDefinitionsApi } from "../../api/fieldDefinitions.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader, Spinner } from "../../components/ui";
import type { FieldDefinition } from "../../types";

export default function ExtractionSettingsPage() {
  const { notify } = useToast();
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setFields(await fieldDefinitionsApi.list());
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (f: FieldDefinition) => {
    try {
      const updated = await fieldDefinitionsApi.toggle(f.key, !f.enabled);
      setFields((prev) => prev.map((x) => (x.key === f.key ? updated : x)));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  const addColumn = async (e: FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    try {
      const created = await fieldDefinitionsApi.addCustom(newLabel, newDesc || undefined);
      setFields((prev) => [...prev, created]);
      setNewLabel("");
      setNewDesc("");
      notify("Column added");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  const remove = async (f: FieldDefinition) => {
    try {
      await fieldDefinitionsApi.remove(f.key);
      setFields((prev) => prev.filter((x) => x.key !== f.key));
      notify("Column removed");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  const enabledCount = fields.filter((f) => f.enabled).length;

  return (
    <div>
      <PageHeader
        title="Extraction settings"
        subtitle="Choose which invoice fields are shown and included in exports."
      />

      {loading ? (
        <Spinner />
      ) : (
        <div className="card" style={{ padding: 20, maxWidth: 720 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>Invoice fields</h3>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 13 }}>{enabledCount} of {fields.length} enabled</span>
          </div>

          <div className="stack" style={{ gap: 2 }}>
            {fields.map((f) => (
              <div key={f.key} className="row gap-12" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {f.label}
                    {f.required && <span className="faint" style={{ fontSize: 12 }}> · Required</span>}
                  </div>
                  {f.description && <div className="faint" style={{ fontSize: 12 }}>{f.description}</div>}
                </div>
                <div className="spacer" />
                {f.isCustom && (
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(f)} title="Remove column">
                    <X size={14} />
                  </button>
                )}
                <button
                  className="switch"
                  data-on={f.enabled}
                  disabled={f.required}
                  onClick={() => toggle(f)}
                  aria-label={`Toggle ${f.label}`}
                />
              </div>
            ))}
          </div>

          <form onSubmit={addColumn} className="row gap-8" style={{ marginTop: 18, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Column title"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <button className="btn btn-primary" type="submit">+ Add column</button>
          </form>
        </div>
      )}
    </div>
  );
}
