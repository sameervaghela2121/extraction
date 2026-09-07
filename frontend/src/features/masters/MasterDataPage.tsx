import { Navigate, useParams } from "react-router-dom";
import MasterSection from "./MasterSection";
import { MASTER_SPECS } from "./specs";

/** One master per route (/masters/vendors, …) so each gets its own sidebar entry. */
export default function MasterDataPage() {
  const { section } = useParams();
  const spec = MASTER_SPECS.find((s) => s.key === section);
  if (!spec) return <Navigate to={`/masters/${MASTER_SPECS[0].key}`} replace />;
  // key remounts on section change, so the previous master's rows and search don't linger.
  return <MasterSection key={spec.key} spec={spec} />;
}
