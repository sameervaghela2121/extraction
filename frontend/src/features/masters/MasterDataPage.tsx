import { Navigate, useParams } from "react-router-dom";
import MasterSection from "./MasterSection";
import RawMaterialPage from "./RawMaterialPage";
import RollsPage from "./RollsPage";
import { MASTER_SPECS } from "./specs";

/** One master per route (/masters/vendors, …) so each gets its own sidebar entry. */
export default function MasterDataPage() {
  const { section } = useParams();

  // Not a MasterSpec: its rows are papers embedded in vendors rather than a collection of
  // their own, so it has no CRUD endpoint of its own and needs a vendor picker on the form.
  if (section === "raw-material") return <RawMaterialPage />;

  // Also not a MasterSpec: this endpoint pages server-side, has read-only server-owned
  // fields, and corrects its stock figure through a movement rather than a PATCH.
  if (section === "rolls") return <RollsPage />;

  const spec = MASTER_SPECS.find((s) => s.key === section);
  if (!spec) return <Navigate to={`/masters/${MASTER_SPECS[0].key}`} replace />;
  // key remounts on section change, so the previous master's rows and search don't linger.
  return <MasterSection key={spec.key} spec={spec} />;
}
