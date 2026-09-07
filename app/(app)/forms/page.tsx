import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/Panel";
import { FormsTabs } from "@/components/form-relay/FormsTabs";
import { SubmissionsInbox } from "@/components/form-relay/SubmissionsInbox";
import { requireForms } from "@/lib/forms/guard";
import { endpointInScope } from "@/lib/forms/access";
import type { FormEndpointRow } from "@/lib/forms/types";

export default async function FormsPage() {
  const auth = await requireForms("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { data } = await auth.admin.from("form_endpoints").select("id, name, lead_id").order("name");
  const endpoints = ((data ?? []) as Pick<FormEndpointRow, "id" | "name" | "lead_id">[])
    .filter((e) => endpointInScope(e, auth.scope))
    .map((e) => ({ id: e.id, name: e.name }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Forms" description="Submissions from your client websites, relayed to the client by email and kept here." />
      <FormsTabs />
      <Suspense>
        <SubmissionsInbox endpoints={endpoints} canManage={auth.perms.has("forms.manage")} />
      </Suspense>
    </div>
  );
}
