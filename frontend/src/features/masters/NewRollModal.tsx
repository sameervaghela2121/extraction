import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { lotsApi } from "../../api/lots.api";
import { vendorsApi } from "../../api/masters.api";
import { rollsApi } from "../../api/rolls.api";
import ImageDropzone from "../../components/ImageDropzone";
import SearchSelect from "../../components/SearchSelect";
import { Modal } from "../../components/ui";
import { documentTypeLabel } from "./lotDocument";
import type { GodownLocation, Lot, MaterialRoll, MaterialType, Vendor, VendorPaper } from "../../types";

/** The server pages lots at 200 at most; newest first, so that is the deliveries in hand. */
const LOT_PICKER_SIZE = 200;

/** A paper by whichever codes it has — a Delta-only or RT-only paper has no supplier code. */
function paperLabel(paper: VendorPaper): string {
  return [
    paper.supplier_code_number,
    paper.royal_touche_code && `RT ${paper.royal_touche_code}`,
    paper.delta_code && `Delta ${paper.delta_code}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function FieldLabel({ text }: { text: string }) {
  return <span className="faint">{text}</span>;
}

const FIELD = { display: "grid", gap: 4, fontSize: 13 } as const;

/**
 * Registers a roll from the admin panel: the same fields the app's registration form requires,
 * for a roll entered at a desk. The photos are optional here — the person typing it in may not
 * be standing at the roll. The server writes the IN movement, as it does for the app.
 */
export default function NewRollModal({
  materials,
  locations,
  onClose,
  onCreated,
}: {
  materials: MaterialType[];
  locations: GodownLocation[];
  onClose: () => void;
  onCreated: (roll: MaterialRoll) => void;
}) {
  const { notify } = useToast();
  const [lots, setLots] = useState<Lot[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [lotId, setLotId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [weight, setWeight] = useState("");
  // en-CA formats as yyyy-mm-dd, in the local day rather than UTC's.
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [locationId, setLocationId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [paperIndex, setPaperIndex] = useState("");
  const [gsm, setGsm] = useState("");
  const [width, setWidth] = useState("");
  const [side1, setSide1] = useState<File | null>(null);
  const [side2, setSide2] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [lotPage, allVendors] = await Promise.all([
          lotsApi.list({ pageSize: LOT_PICKER_SIZE }),
          vendorsApi.list(),
        ]);
        setLots(lotPage.items);
        setVendors(allVendors.filter((v) => v.status === "active"));
      } catch (err) {
        notify(apiErrorMessage(err), "error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const papers = useMemo(() => vendors.find((v) => v.id === vendorId)?.papers ?? [], [vendors, vendorId]);
  const paper = paperIndex === "" ? undefined : papers[Number(paperIndex)];

  const complete =
    lotId &&
    barcode.trim() &&
    rollNumber.trim() &&
    materialId &&
    Number(weight) > 0 &&
    date &&
    locationId &&
    vendorId &&
    paper &&
    Number(gsm) > 0 &&
    Number(width) > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!complete || !paper) return;
    setSaving(true);
    try {
      const [side1Path, side2Path] = await Promise.all([
        side1 ? rollsApi.uploadPhoto(side1) : undefined,
        side2 ? rollsApi.uploadPhoto(side2) : undefined,
      ]);
      const roll = await rollsApi.create({
        lot_id: lotId,
        barcode: barcode.trim(),
        roll_number: rollNumber.trim(),
        material_id: materialId,
        weight: Number(weight),
        date,
        location: locationId,
        vendor_id: vendorId,
        papers: [paper],
        gsm: Number(gsm),
        width: Number(width),
        side1_photo_path: side1Path,
        side2_photo_path: side2Path,
      });
      onCreated(roll);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={() => !saving && onClose()} title="New roll" size="large">
      <form onSubmit={submit} style={{ display: "grid", gap: 14, padding: 16 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))", alignItems: "start" }}>
          <div style={FIELD}>
            <FieldLabel text="Lot *" />
            <SearchSelect
              placeholder="Search a challan or invoice"
              value={lotId}
              onChange={setLotId}
              options={lots.map((l) => ({
                value: l.id,
                label: `${documentTypeLabel(l.document_type)} ${l.document_no}`,
              }))}
            />
          </div>
          <label style={FIELD}>
            <FieldLabel text="Barcode *" />
            <input className="input" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </label>

          <label style={FIELD}>
            <FieldLabel text="Roll number *" />
            <input className="input" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} />
          </label>
          <div style={FIELD}>
            <FieldLabel text="Material *" />
            <SearchSelect
              placeholder="Search a material"
              value={materialId}
              onChange={setMaterialId}
              options={materials.map((m) => ({ value: m.id, label: `${m.material_code} · ${m.name}` }))}
            />
          </div>

          <label style={FIELD}>
            <FieldLabel text="Weight (kg) *" />
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <label style={FIELD}>
            <FieldLabel text="Date *" />
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <div style={FIELD}>
            <FieldLabel text="Location *" />
            <SearchSelect
              placeholder="Search a location"
              value={locationId}
              onChange={setLocationId}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
          </div>
          <div style={FIELD}>
            <FieldLabel text="Vendor *" />
            <SearchSelect
              placeholder="Search a vendor"
              value={vendorId}
              onChange={(id) => {
                setVendorId(id);
                // Papers belong to a vendor, so the one picked for the last vendor no longer applies.
                setPaperIndex("");
              }}
              options={vendors.map((v) => ({ value: v.id, label: `${v.vendor_code} · ${v.name}` }))}
            />
          </div>

          <div style={FIELD}>
            <FieldLabel text="Paper code *" />
            <SearchSelect
              placeholder={vendorId ? "Search a paper code" : "Select a vendor first"}
              value={paperIndex}
              onChange={setPaperIndex}
              options={papers.map((p, index) => ({ value: String(index), label: paperLabel(p) }))}
            />
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            <label style={FIELD}>
              <FieldLabel text="GSM *" />
              <input
                className="input"
                type="number"
                min={0}
                step="any"
                value={gsm}
                onChange={(e) => setGsm(e.target.value)}
              />
            </label>
            <label style={FIELD}>
              <FieldLabel text="Width (mm) *" />
              <input
                className="input"
                type="number"
                min={0}
                step="any"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </label>
          </div>

          <div style={FIELD}>
            <FieldLabel text="Front photo" />
            <ImageDropzone file={side1} onChange={setSide1} label="Front photo" disabled={saving} />
          </div>
          <div style={FIELD}>
            <FieldLabel text="Back photo" />
            <ImageDropzone file={side2} onChange={setSide2} label="Back photo" disabled={saving} />
          </div>
        </div>

        <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !complete}>
            {saving ? "Creating…" : "Create roll"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
