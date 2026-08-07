import { PageHeader } from "../../components/ui";
import UploadTabs from "../upload/UploadTabs";

export default function GeneralVoucherUploadPage() {
  return (
    <div>
      <PageHeader title="Upload General Voucher" subtitle="Bring vouchers into DocFlow for automatic extraction." />
      <UploadTabs purpose="voucher" redirectTo="/general-vouchers" />
    </div>
  );
}
