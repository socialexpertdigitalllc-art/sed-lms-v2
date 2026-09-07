import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { FormsTabs } from "@/components/form-relay/FormsTabs";
import { EndpointsTable } from "@/components/form-relay/EndpointsTable";
import { requireForms } from "@/lib/forms/guard";
import { endpointInScope } from "@/lib/forms/access";
import { utcDayStart } from "@/lib/forms/gate";
import type { EndpointListItem, FormEndpointRow } from "@/lib/forms/types";

export default async function EndpointsPage() {
  const auth = await requireForms("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");
  const { admin, scope } = auth;

  const { data } = await admin.from("form_endpoints").select("*").order("created_at", { ascending: false });
  const visible = ((data ?? []) as FormEndpointRow[]).filter((e) => endpointInScope(e, scope));

  const counts = new Map<string, number>();
  const { data: today } = visible.length === 0 ? { data: [] } : await admin.from("form_submissions").select("endpoint_id").in("endpoint_id", visible.map((e) => e.id)).eq("is_spam", false).gte("created_at", utcDayStart());
  for (const r of today ?? []) counts.set(r.endpoint_id as string, (counts.get(r.endpoint_id as string) ?? 0) + 1);
  const endpoints: EndpointListItem[] = visible.map((e) => ({ ...e, today_count: counts.get(e.id) ?? 0 }));

  const leadIds = [...new Set(visible.map((e) => e.lead_id).filter((v): v is string => Boolean(v)))];
  const leadNames: Record<string, string> = {};
  if (leadIds.length) {
    const { data: leads } = await admin.from("leads").select("id, business_name").in("id", leadIds);
    for (const l of leads ?? []) leadNames[l.id as string] = l.business_name as string;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Forms" description="One endpoint per client website. Each has its own access key and recipients." />
      <FormsTabs />
      <EndpointsTable endpoints={endpoints} leadNames={leadNames} canManage={auth.perms.has("forms.manage")} />
    </div>
  );
}
