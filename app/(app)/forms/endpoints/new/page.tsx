import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { EndpointEditor } from "@/components/form-relay/EndpointEditor";
import { requireForms } from "@/lib/forms/guard";
import { loadEditorOptions } from "@/lib/forms/editorOptions";

export default async function NewEndpointPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead } = await searchParams;
  const auth = await requireForms("manage");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/forms");
  const { leads, mailboxes } = await loadEditorOptions(auth);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="New form endpoint" description="Creates an access key the client site posts to." />
      <EndpointEditor initial={null} leads={leads} mailboxes={mailboxes} presetLeadId={lead ?? null} />
    </div>
  );
}
