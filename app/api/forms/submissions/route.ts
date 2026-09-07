import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { submissionInScope } from "@/lib/forms/access";
import type { FormSubmissionRow, SubmissionListItem } from "@/lib/forms/types";

const PAGE = 50;

/**
 * Inbox listing. Filters: endpoint, lead, spam (1|0), status, q (subject /
 * submitter), before (created_at cursor). Scope is applied IN THE QUERY:
 * filtering in JS after a limit would silently drop a scoped user's older
 * rows whenever other tenants' submissions fill the fetched window, and
 * next_before would lie about the end of the list.
 */
export async function GET(req: Request) {
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const { admin, scope } = auth;
  const p = new URL(req.url).searchParams;

  let query = admin.from("form_submissions").select("*").order("created_at", { ascending: false }).limit(PAGE);
  if (!scope.all) {
    const ids = [...scope.leadIds];
    if (scope.manage) {
      // Scoped managers also see lead-less endpoints' submissions.
      query = ids.length ? query.or(`lead_id.in.(${ids.join(",")}),lead_id.is.null`) : query.is("lead_id", null);
    } else {
      if (!ids.length) return NextResponse.json({ submissions: [], next_before: null });
      query = query.in("lead_id", ids);
    }
  }
  const endpoint = p.get("endpoint"); if (endpoint) query = query.eq("endpoint_id", endpoint);
  const lead = p.get("lead"); if (lead) query = query.eq("lead_id", lead);
  const spam = p.get("spam"); if (spam === "1" || spam === "0") query = query.eq("is_spam", spam === "1");
  const status = p.get("status"); if (status) query = query.eq("delivery_status", status);
  const before = p.get("before"); if (before) query = query.lt("created_at", before);
  const q = p.get("q")?.trim(); if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`subject.ilike.%${safe}%,submitter_email.ilike.%${safe}%,submitter_name.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Scope already applied in the query; this filter is belt-and-braces.
  const rows = ((data ?? []) as FormSubmissionRow[]).filter((s) => submissionInScope(s, scope));

  const endpointIds = [...new Set(rows.map((r) => r.endpoint_id))];
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((v): v is string => Boolean(v)))];
  const endpointNames = new Map<string, string>();
  const leadNames = new Map<string, string>();
  if (endpointIds.length) {
    const { data: eps } = await admin.from("form_endpoints").select("id, name").in("id", endpointIds);
    for (const e of eps ?? []) endpointNames.set(e.id as string, e.name as string);
  }
  if (leadIds.length) {
    const { data: leads } = await admin.from("leads").select("id, business_name").in("id", leadIds);
    for (const l of leads ?? []) leadNames.set(l.id as string, l.business_name as string);
  }

  const submissions: SubmissionListItem[] = rows.map((r) => ({
    ...r,
    endpoint_name: endpointNames.get(r.endpoint_id) ?? null,
    lead_name: r.lead_id ? leadNames.get(r.lead_id) ?? null : null,
  }));
  // Cursor from the RAW page, not the filtered rows — a full raw page means
  // there may be more, regardless of what the defensive filter kept.
  const raw = (data ?? []) as FormSubmissionRow[];
  const next_before = raw.length === PAGE ? raw[raw.length - 1].created_at : null;
  return NextResponse.json({ submissions, next_before });
}
