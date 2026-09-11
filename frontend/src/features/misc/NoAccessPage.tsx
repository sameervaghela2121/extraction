import { PageHeader } from "../../components/ui";

// Landing spot for a role whose only pages are temporarily disabled (see router.tsx —
// staff's home is /grn, commented out along with the rest of the main nav). Remove this
// once those routes come back and point HOME_FOR_ROLE.staff at /grn again.
export default function NoAccessPage() {
  return (
    <div>
      <PageHeader title="Nothing available right now" subtitle="This section is temporarily disabled. Check back shortly." />
    </div>
  );
}
