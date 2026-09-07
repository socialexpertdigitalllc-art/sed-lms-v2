import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { endpointInScope, leadInScope } from "@/lib/forms/access";
import { endpointInputSchema, generateAccessKey } from "@/lib/forms/schema";
import { utcDayStart } from "@/lib/forms/gate";
import type { EndpointListItem, FormEndpointRow } from "@/lib/forms/types";

export async function GET() {
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const { admin, scope } = auth;

  const { data, error } = await admin.from("form_endpoints").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const visible = ((data ?? []) as FormEndpointRow[]).filter((e) => endpointInScope(e, scope));

  const counts = new Map<string, number>();
  const { data: today } = visible.length === 0 ? { data: [] } : await admin.from("form_submissions").select("endpoint_id").in("endpoint_id", visible.map((e) => e.id)).eq("is_spam", false).gte("created_at", utcDayStart());
  for (const r of today ?? []) counts.set(r.endpoint_id as string, (counts.get(r.endpoint_id as string) ?? 0) + 1);

  const endpoints: EndpointListItem[] = visible.map((e) => ({ ...e, today_count: counts.get(e.id) ?? 0 }));
  return NextResponse.json({ endpoints });
}

export async function POST(req: Request) {
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);

  const parsed = endpointInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid endpoint", issues: parsed.error.flatten() }, { status: 422 });
  // A scoped manager (forms.manage without leads.view_all) may only attach
  // endpoints to their OWN leads — the schema accepts any uuid.
  if (!leadInScope(parsed.data.lead_id, auth.scope)) {
    return NextResponse.json({ error: "Lead is outside your scope" }, { status: 403 });
  }

  const { data, error } = await auth.admin
    .from("form_endpoints")
    .insert({ ...parsed.data, access_key: generateAccessKey(), created_by: auth.userId })
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });

  await auth.admin.from("activity_log").insert({ user_id: auth.userId, action: "form_endpoint.created", entity_type: "form_endpoint", entity_id: data.id, new_value: { name: data.name, lead_id: data.lead_id } });
  return NextResponse.json({ endpoint: data }, { status: 201 });
}
