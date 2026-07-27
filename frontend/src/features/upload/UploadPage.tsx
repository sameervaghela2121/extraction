import { PageHeader } from "../../components/ui";
import UploadTabs from "./UploadTabs";

export default function UploadPage() {
  return (
    <div>
      <PageHeader title="Upload & Scan" subtitle="Bring invoices into DocFlow for automatic extraction." />
      <UploadTabs />
    </div>
  );
}
