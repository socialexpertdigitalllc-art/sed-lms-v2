import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { EndpointEditor } from "@/components/form-relay/EndpointEditor";
import { IntegrationCard } from "@/components/form-relay/IntegrationCard";
import { requireForms } from "@/lib/forms/guard";
import { endpointInScope } from "@/lib/forms/access";
import { relaySubmitUrl } from "@/lib/forms/snippet";
import { loadEditorOptions } from "@/lib/forms/editorOptions";
import type { FormEndpointRow } from "@/lib/forms/types";

export default async function EndpointPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireForms("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { data } = await auth.admin.from("form_endpoints").select("*").eq("id", id).maybeSingle();
  if (!data || !endpointInScope(data as FormEndpointRow, auth.scope)) notFound();
  const endpoint = data as FormEndpointRow;
  const canManage = auth.perms.has("forms.manage");
  const { leads, mailboxes } = await loadEditorOptions(auth);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={endpoint.name} description={endpoint.status === "paused" ? "Paused — submissions are rejected." : "Active."} />
      <IntegrationCard endpointId={endpoint.id} url={relaySubmitUrl()} accessKey={endpoint.access_key} canManage={canManage} />
      {canManage ? <EndpointEditor initial={endpoint} leads={leads} mailboxes={mailboxes} /> : null}
    </div>
  );
}
